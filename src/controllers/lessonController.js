const axios = require("axios");
const mysql = require("mysql2/promise");
const path = require("path");
const { VertexAI } = require("@google-cloud/vertexai");
const fs = require("fs/promises");
const { GoogleGenAI } = require("@google/genai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ Create MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
});

// ✅ Prompt API
const PROMPT_API_URL = `${process.env.BASE_URL}/get-prompt/`;
console.log("=============> process.env.BASE_URL =================>" + process.env.BASE_URL);
console.log("=============> process.env.GOOGLE_API_KEY =================>" + process.env.GOOGLE_API_KEY);

const fetchPromptFromAPI = async (subject, type) => {
  try {
    const response = await axios.get(
      `${PROMPT_API_URL}${encodeURIComponent(subject)}/${encodeURIComponent(type)}`
    );
    if (response.data.success && response.data.data?.prompt) {
      return response.data.data.prompt;
    } else {
      throw new Error(`Prompt not found for subject "${subject}" and type "${type}"`);
    }
  } catch (error) {
    console.error(`❌ Error fetching prompt:`, error.message);
    throw error;
  }
};

process.env.GOOGLE_APPLICATION_CREDENTIALS = "/cred/tutoh-466212-c4b22734d8fb.json";
const PROJECT_ID = "tutoh-466212";
const LOCATION = "us-central1";

// ✅ Create Vertex AI client
const vertexAI = new VertexAI({
  project: PROJECT_ID,
  location: LOCATION,
});

const fetch =
  global.fetch ||
  ((...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args)));

// === helpers omitted for brevity, unchanged (ensureOutputDir, sanitizeFilename, detectMimeType, uploadBase64Image, generateDiagram, storeImageInDatabase, processLessonContent, checkDatabaseColumns, initializeDatabase) ===
// (keep everything you pasted before as-is)

initializeDatabase().catch(console.error);

const startLesson = async (req, res) => {
  let connection;
  try {
    const {
      student_id,
      student_name,
      subject,
      exam_board,
      tier,
      lesson_topic_code,
      lesson_topic,
      messages = [],
      student_previous_summary,
      type,
      lesson_id,
    } = req.body;

    // Get connection early
    connection = await pool.getConnection();

    // Basic validation
    if (
      !student_id ||
      !student_name ||
      !subject ||
      !exam_board ||
      !tier ||
      !lesson_topic_code ||
      !lesson_topic
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    console.log("📚 Starting lesson for:", {
      student_name,
      subject,
      lesson_topic,
      lesson_id,
    });

    // Normalize subject
    const normalizedSubject = subject.trim().toLowerCase();

    // Fetch system prompt dynamically
    let systemPrompt;
    try {
      const promptType = type?.trim() || "lesson";
      systemPrompt = await fetchPromptFromAPI(subject.trim(), promptType);
      console.log("✅ Successfully fetched prompt:", promptType);
    } catch (error) {
      console.error("❌ Error fetching prompt from API:", error.message);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch prompt for subject: ${subject} and type: ${type}`,
      });
    }

    // Helper: Date → MySQL DATETIME
    const toMySQLDateTime = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 19).replace("T", " ");
    };

    // Check DB columns
    const columnCheck = await checkDatabaseColumns(connection);

    // Check existing session
    const [existingSessions] = await connection.query(
      `SELECT id FROM tutoring_sessions 
       WHERE student_id = ? 
       AND subject = ? 
       AND exam_board = ? 
       AND tier = ? 
       AND lesson_topic_code = ? 
       AND lesson_topic = ?`,
      [
        student_id,
        normalizedSubject,
        exam_board,
        tier,
        lesson_topic_code,
        lesson_topic,
      ]
    );

    let sessionId;
    if (existingSessions.length > 0) {
      sessionId = existingSessions[0].id;
      console.log(`🔄 Using existing session ID: ${sessionId}`);

      // Insert latest message only
      if (messages.length > 0) {
        const latestMessage = messages[messages.length - 1];
        if (latestMessage.content?.trim()) {
          await connection.query(
            `INSERT INTO session_messages 
             (session_id, role, content, timestamp, message_id, student_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              sessionId,
              latestMessage.role,
              latestMessage.content.trim(),
              toMySQLDateTime(latestMessage.timestamp || new Date()),
              latestMessage.id || null,
              student_id,
            ]
          );
          console.log(`💬 Inserted latest message for session ${sessionId}`);
        }
      }
    } else {
      // Create new session
      const [result] = await connection.query(
        `INSERT INTO tutoring_sessions (
          student_id, student_name, subject, exam_board, tier, 
          lesson_topic_code, lesson_topic, lesson_start_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_id,
          student_name,
          normalizedSubject,
          exam_board,
          tier,
          lesson_topic_code,
          lesson_topic,
          toMySQLDateTime(new Date()),
        ]
      );
      sessionId = result.insertId;
      console.log(`🆕 Created new session ID: ${sessionId}`);

      // Insert initial messages
      if (messages.length > 0) {
        const messageValues = messages
          .filter((msg) => msg.content?.trim())
          .map((msg) => [
            sessionId,
            msg.role,
            msg.content.trim(),
            toMySQLDateTime(msg.timestamp || new Date()),
            msg.id || null,
            student_id,
          ]);

        if (messageValues.length > 0) {
          await connection.query(
            `INSERT INTO session_messages 
             (session_id, role, content, timestamp, message_id, student_id) 
             VALUES ?`,
            [messageValues]
          );
          console.log(`💬 Inserted ${messageValues.length} initial messages`);
        }
      }
    }

    const userLessonInput = {
      student_id,
      student_name,
      subject: normalizedSubject,
      exam_board,
      tier,
      lesson_topic_code,
      lesson_topic,
      lesson_start_time: toMySQLDateTime(new Date()),
      student_previous_summary,
    };

    // ✅ Vertex AI Gemini Model
    const model = vertexAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 1,
        topP: 0.95,
        candidateCount: 1,
      },
      systemInstruction: {
        role: "system",
        parts: [{ text: systemPrompt }],
      },
    });

    console.log("🤖 Chat session created with Vertex AI Gemini");

    // ✅ create chat session (stateful, one-to-one)
    const chat = model.startChat({
      history: [
        {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 1,
        topP: 0.95,
      },
    });

    // ✅ Build the full lesson context + latest student response
    let studentResponse = messages[messages.length - 1]?.content?.trim();
    if (!studentResponse) {
      studentResponse = "(no response provided)";
    }

    const messagePayload = {
      ...userLessonInput,
      student_response: studentResponse,
    };

    let safeText = JSON.stringify(messagePayload);
    if (!safeText || safeText === "{}") {
      safeText = `(lesson payload missing, student said: ${studentResponse})`;
    }

    console.log("📤 Sending safe message to Gemini:", safeText);

    // ✅ Request Gemini response (await one-to-one reply)
    const response = await chat.sendMessage({
      contents: [
        {
          role: "user",
          parts: [{ text: safeText }],
        },
      ],
    });

    // 🚨 Log the full response for debugging
    console.log("📥 Gemini raw response:", JSON.stringify(response, null, 2));

    // ✅ Extract assistant text safely
    let assistantContent =
      response?.response?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("\n") || "";

    console.log("📥 Extracted assistantContent:", assistantContent);

    let processedContent = assistantContent;
    let hasVisuals = false;
    const messageId = Date.now().toString();

    // Handle visuals if present
    if (assistantContent?.includes("CreateVisual:")) {
      console.log("🎨 Processing visual content...");
      hasVisuals = true;

      processedContent = await processLessonContent(
        assistantContent,
        normalizedSubject,
        sessionId,
        messageId,
        connection,
        lesson_id
      );
    }

    // Save assistant message
    if (assistantContent) {
      const assistantMessage = {
        role: "assistant",
        content: assistantContent,
        processed_content: processedContent,
        has_visuals: hasVisuals,
        timestamp: toMySQLDateTime(new Date()),
        id: messageId,
      };

      console.log("📝 Saving assistant message:", assistantMessage);

      let insertQuery =
        "INSERT INTO session_messages (session_id, role, content, timestamp, message_id, student_id";
      let insertValues = [
        sessionId,
        assistantMessage.role,
        assistantMessage.content,
        assistantMessage.timestamp,
        assistantMessage.id,
        student_id,
      ];

      if (columnCheck.hasProcessedContent) {
        insertQuery += ", processed_content";
        insertValues.push(assistantMessage.processed_content);
      }
      if (columnCheck.hasVisuals) {
        insertQuery += ", has_visuals";
        insertValues.push(assistantMessage.has_visuals);
      }
      if (columnCheck.hasRawResponse) {
        insertQuery += ", raw_response";
        insertValues.push(JSON.stringify(response));
      }

      insertQuery += ") VALUES (?, ?, ?, ?, ?, ?";
      if (columnCheck.hasProcessedContent) insertQuery += ", ?";
      if (columnCheck.hasVisuals) insertQuery += ", ?";
      if (columnCheck.hasRawResponse) insertQuery += ", ?";
      insertQuery += ")";

      await connection.query(insertQuery, insertValues);
    } else {
      console.warn("⚠ No assistant content returned from Gemini");
    }

    // Final JSON response
    const finalResponse = {
      success: true,
      sessionId,
      hasVisuals,
      lesson_id,
      data: {
        choices: [
          { message: { role: "assistant", content: processedContent } },
        ],
      },
    };

    console.log("📤 Final API Response to frontend:", finalResponse);

    return res.json(finalResponse);
  } catch (error) {
    console.error("❌ Lesson Error:", error);
    return res.status(500).json({
      success: false,
      error:
        error.response?.data?.error?.message ||
        error.message ||
        "Internal Server Error",
    });
  } finally {
    if (connection) {
      try {
        connection.release();
      } catch (e) {
        console.warn("⚠ Tried releasing connection twice");
      }
    }
  }
};


// === getLessonHistory and saveLessonData unchanged ===

module.exports = {
  startLesson,
  getLessonHistory,
  saveLessonData,
  generateDiagram,
};
