const axios = require("axios");
const mysql = require("mysql2/promise");
const path = require("path");
const { VertexAI } = require("@google-cloud/vertexai");
const fs = require("fs/promises");
const { GoogleGenAI } = require("@google/genai");
const { GoogleGenerativeAI } = require("@google/generative-ai");

process.env.GOOGLE_APPLICATION_CREDENTIALS =
  "/cred/tutoh-466212-c4b22734d8fb.json";

const PROJECT_ID = "tutoh-466212";
const LOCATION = "us-central1";

// ✅ Create Vertex AI client
const vertexAI = new VertexAI({
  project: PROJECT_ID,
  location: LOCATION,
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const PROMPT_API_URL = `${process.env.BASE_URL}/get-prompt/`;

// Function to fetch prompt from API
const fetchPromptFromAPI = async (subject, type) => {
  try {
    const encodedSubject = encodeURIComponent(subject);
    const encodedType = encodeURIComponent(type);
    const response = await axios.get(`${PROMPT_API_URL}${encodedSubject}/${encodedType}`);

    if (response.data.success && response.data.data?.prompt) {
      return response.data.data.prompt;
    }
    throw new Error(`No prompt found for subject: ${subject} and type: ${type}`);
  } catch (error) {
    console.error(`Error fetching prompt for ${subject} (${type}):`, error.message);
    throw error;
  }
};

const extractJson = (text) => {
  const regex = /```json\s*([\s\S]*?)\s*```/;
  const match = text.match(regex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (err) {
      console.error("Failed to parse JSON inside markdown block:", err.message);
    }
  }

  const firstBraceIndex = text.indexOf("{");
  const lastBraceIndex = text.lastIndexOf("}");
  if (firstBraceIndex !== -1 && lastBraceIndex !== -1) {
    const possibleJson = text.slice(firstBraceIndex, lastBraceIndex + 1);
    try {
      return JSON.parse(possibleJson);
    } catch (err) {
      console.error("Fallback JSON parsing also failed:", err.message);
    }
  }

  return null;
};

const generateVisual = async (description) => {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/images/generations",
      {
        prompt: `A clear GCSE mathematics diagram illustrating: ${description}. 
                 Use a clean white background with black lines and minimal colors.`,
        n: 1,
        size: "512x512",
        response_format: "url"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.data[0].url;
  } catch (error) {
    console.error("DALL·E Error:", error.response?.data || error.message);
    return null;
  }
};

const processVisualRequests = async (content) => {
  const visualRegex = /\[CreateVisual: "(.*?)"\]/g;
  let matches;
  const visualPromises = [];
  const replacements = [];

  // Find all visual requests in the content
  while ((matches = visualRegex.exec(content)) !== null) {
    const [fullMatch, description] = matches;
    visualPromises.push(
      generateVisual(description).then(url => ({
        original: fullMatch,
        replacement: url ? `<img src="${url}" alt="${description}" class="math-diagram">` : ''
      }))
    );
  }

  // Wait for all images to generate
  const results = await Promise.all(visualPromises);
  
  // Replace visual markers with image tags
  let processedContent = content;
  results.forEach(({original, replacement}) => {
    processedContent = processedContent.replace(original, replacement);
  });

  return processedContent;
};

// Helper function to check database columns (similar to lesson code)
const checkDatabaseColumns = async (connection) => {
  try {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mock_test_sessions'
    `, [process.env.DB_DATABASE]);
    
    const columnNames = columns.map(col => col.COLUMN_NAME.toLowerCase());
    
    return {
      hasProcessedContent: columnNames.includes('processed_content'),
      hasVisuals: columnNames.includes('has_visuals'),
      hasRawResponse: columnNames.includes('raw_response')
    };
  } catch (error) {
    console.warn("Could not check database columns:", error.message);
    return {
      hasProcessedContent: false,
      hasVisuals: false,
      hasRawResponse: false
    };
  }
};

const toMySQLDateTime = (date) => {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
};

const startMockTest = async (req, res) => {
  let connection;
  try {
    const {
      student_id,
      student_name,
      exam_board,
      tier,
      mock_cycle = 1,
      predicted_grade = "6",
      is_continuation = false,
      chat_history = [],
      student_response = null,
      current_question = null,
      exam_type,
      subject
    } = req.body;

    if (!student_id || !student_name) {
      return res.status(400).json({
        success: false,
        error: "student_id and student_name are required"
      });
    }

    const supportedBoards = ["AQA", "Edexcel", "OCR"];
    if (!supportedBoards.includes(exam_board)) {
      return res.status(400).json({
        success: false,
        error: `Exam board ${exam_board} not supported. Supported boards: ${supportedBoards.join(", ")}`
      });
    }

    const validTiers = ["Foundation", "Higher"];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier: ${tier}. Must be either Foundation or Higher`
      });
    }

    // Get connection from pool
    connection = await pool.getConnection();

    // Fetch the appropriate prompt based on subject and exam_type
    let systemPrompt;
    try {
      const promptType = exam_type?.trim() || "mock";
      systemPrompt = await fetchPromptFromAPI(subject.trim(), promptType);
      console.log("✅ Successfully fetched prompt from API for type:", promptType);
    } catch (error) {
      console.error("❌ Error fetching prompt from API:", error);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch prompt for subject: ${subject} and type: ${exam_type}`
      });
    }

    const normalizedSubject = subject.trim().toLowerCase();
    
    // Check database columns for additional fields
    const columnCheck = await checkDatabaseColumns(connection);

    // Handle database session management
    const [existingSessions] = await connection.query(
      `SELECT id FROM mock_test_sessions 
       WHERE student_id = ? 
       AND subject = ? 
       AND exam_board = ? 
       AND tier = ? 
       AND mock_cycle = ?`,
      [student_id, normalizedSubject, exam_board, tier, mock_cycle]
    );

    let sessionId;
    let isNewSession = false;

    if (existingSessions.length > 0) {
      sessionId = existingSessions[0].id;
      console.log(`🔄 Using existing mock test session ID: ${sessionId}`);
    } else {
      const [result] = await connection.query(
        `INSERT INTO mock_test_sessions (
          student_id, student_name, subject, exam_board, tier, 
          mock_cycle, predicted_grade, test_start_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_id,
          student_name,
          normalizedSubject,
          exam_board,
          tier,
          mock_cycle,
          predicted_grade,
          toMySQLDateTime(new Date())
        ]
      );
      sessionId = result.insertId;
      isNewSession = true;
      console.log(`🆕 Created new mock test session ID: ${sessionId}`);
    }

    // Prepare message payload for Gemini
    let messagePayload;
    let geminiHistory = [];

    if (is_continuation) {
      // Convert chat_history to Gemini format
      geminiHistory = chat_history.map(msg => ({
        role: msg.role === "assistant" ? "model" : msg.role,
        parts: [{ text: msg.content }]
      }));

      messagePayload = {
        student_id,
        student_name,
        subject: normalizedSubject,
        exam_board,
        tier,
        mock_cycle,
        predicted_grade,
        current_question,
        student_response,
        is_continuation: true
      };
    } else {
      messagePayload = {
        student_id,
        student_name,
        subject: normalizedSubject,
        exam_board,
        tier,
        mock_cycle,
        predicted_grade,
        test_start_time: toMySQLDateTime(new Date())
      };
    }

    console.log("📚 Starting mock test for:", {
      student_name,
      subject: normalizedSubject,
      exam_board,
      tier,
      mock_cycle,
      sessionId
    });

    // Create Gemini model instance
    const model = vertexAI.getGenerativeModel({
      model: "gemini-2.5-flash",
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

    console.log("🤖 Mock test chat session created with Vertex AI Gemini");

    // Start chat session
    const chat = model.startChat({
      history: geminiHistory,
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 1,
        topP: 0.95,
      },
    });

    console.log("📤 Sending payload to Gemini:", JSON.stringify(messagePayload, null, 2));

    // Send message to Gemini
    const response = await chat.sendMessage([
      { text: JSON.stringify(messagePayload) }
    ]);

    console.log("📥 Gemini raw response:", JSON.stringify(response, null, 2));

    // Extract assistant content
    let assistantResponse = response?.response?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("\n") || "";

    console.log("📥 Extracted assistantResponse:", assistantResponse);

    if (!assistantResponse) {
      console.warn("⚠ No assistant content returned from Gemini");
      return res.status(500).json({
        success: false,
        error: "No response generated from Gemini"
      });
    }

const messageId = `${student_id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let hasVisuals = false;
    let processedContent = assistantResponse;

    // Process visual requests in the response
    if (assistantResponse) {
      const containsCreateVisual = assistantResponse.includes("CreateVisual:");
      const containsImage = /<img\s+src=/.test(assistantResponse);

      if (containsCreateVisual || containsImage) {
        console.log("🎨 Processing visual content...");
        hasVisuals = true;
        processedContent = await processVisualRequests(assistantResponse);
      }
    }


if (assistantResponse) {
  let insertQuery = 
    "INSERT INTO mock_test_messages (session_id, role, content, timestamp, message_id, student_id";
  let insertValues = [
    sessionId,
    "assistant",
    assistantResponse,
    toMySQLDateTime(new Date()),
    messageId,
    student_id
  ];

  if (columnCheck.hasProcessedContent) {
    insertQuery += ", processed_content";
    insertValues.push(processedContent);
  }
  if (columnCheck.hasVisuals) {
    insertQuery += ", has_visuals";
    insertValues.push(hasVisuals);
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
  console.log(`💬 Saved assistant message for session ${sessionId}`);
}

    // Save student response if provided
  if (is_continuation && student_response && current_question) {
  const userMessageId = `${student_id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  await connection.query(
    `INSERT INTO mock_test_messages 
     (session_id, role, content, timestamp, student_id, question_number, message_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      "user",
      student_response,
      toMySQLDateTime(new Date()),
      student_id,
      current_question,
      userMessageId
    ]
  );
  console.log(`💬 Saved student response for question ${current_question}`);
}


    // Extract JSON output from the response
    const jsonOutput = extractJson(processedContent) || {
      note: "Could not parse JSON from response",
      raw_response: processedContent
    };

    // Prepare updated chat history
    let updatedChatHistory = [...chat_history];
    
    if (is_continuation && student_response && current_question) {
      updatedChatHistory.push({
        role: "user",
        content: `Student Response to Question ${current_question}: ${student_response}`,
        timestamp: new Date()
      });
    }

    updatedChatHistory.push({
      role: "assistant",
      content: processedContent,
      timestamp: new Date(),
      id: messageId
    });

    const finalResponse = {
      success: true,
      sessionId,
      hasVisuals,
      data: {
        ...jsonOutput,
        chat_history: updatedChatHistory,
        gemini_response: response,
        session_data: {
          student_id,
          student_name,
          subject: normalizedSubject,
          exam_board,
          tier,
          mock_cycle,
          predicted_grade
        }
      }
    };

    console.log("📤 Final Mock Test API Response:", finalResponse);

    res.json(finalResponse);

  } catch (error) {
    console.error("❌ Mock Test Error:", error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error?.response?.data?.error?.message || error.message || "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

module.exports = {
  startMockTest,
};