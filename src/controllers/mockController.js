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
  // Try code block first
  const regex = /```json\s*([\s\S]*?)\s*```/i;
  const match = text.match(regex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (err) {
      console.error("Failed to parse JSON inside markdown block:", err.message);
    }
  }

  // Fallback: remove ```json fences if present
  let cleaned = text.replace(/```json/i, "").replace(/```/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Fallback JSON parsing also failed:", err.message);
  }

  return null;
};

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



// Ensure outputs directory exists
const ensureOutputDir = async (dir = "./outputs") => {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log("📁 Output directory ready:", dir);
  } catch (e) {
    console.error("❌ Could not create output directory:", e.message);
  }
};

// Sanitize filenames for Windows/Linux
const sanitizeFilename = (name) => {
  return name.replace(/[<>:"/\\|?*\n\r\t]/g, "_").slice(0, 150);
};

// Helper to detect MIME type from buffer
const detectMimeType = (buffer) => {
  if (!buffer || buffer.length < 12) return "application/octet-stream";

  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // WEBP magic number: "RIFF"...."WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return "application/octet-stream";
};

// Helper function to upload base64 image to your endpoint
const uploadBase64Image = async (base64DataUri) => {
  try {
    const response = await fetch(
      `${process.env.BASE_URL}/upload-base64-image`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: base64DataUri,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Upload failed with status: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Image uploaded successfully:", result);

    return {
      success: true,
      url: result.url,
      fileName: result.file_name,
      message: result.message,
    };
  } catch (error) {
    console.error("❌ Error uploading image:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

const generateDiagram = async (
  description,
  imageName = "",
  sessionId = null,
  lessonId = null,
  messageId = null,
  subject = null
) => {
  try {
    if (!description || description.trim().length === 0) {
      throw new Error("❌ Description is required to generate a diagram");
    }

    console.log("🧠 Generating with Gemini AI, prompt:", description);

    const ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_CLOUD_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview", 
      contents: description,
    });

    if (!response?.candidates?.[0]?.content?.parts) {
      throw new Error("❌ No output returned from Gemini AI");
    }

    await ensureOutputDir();
    const timestamp = Date.now();

    const baseName =
      imageName ||
      sanitizeFilename(description).slice(0, 50) ||
      `diagram-${timestamp}`;
    const safeName = sanitizeFilename(baseName);

    let savedFiles = [];
    let uploadedUrls = [];
    let index = 1;

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        const imageData = part.inlineData.data;

        console.log("🔍 Base64 image received:", {
          length: imageData.length,
          preview: imageData.substring(0, 80) + "...",
          ending: "..." + imageData.substring(imageData.length - 80),
        });

        const buffer = Buffer.from(imageData, "base64");

        // Detect MIME type
        const mimeType = detectMimeType(buffer);
        console.log("🧾 Detected MIME type:", mimeType);

        // Save image file locally (optional - for backup)
        const ext =
          mimeType === "image/png"
            ? "png"
            : mimeType === "image/webp"
            ? "webp"
            : "bin";
        const filePath = path.join("./outputs", `${safeName}-${index}.${ext}`);
        await fs.writeFile(filePath, buffer);
        console.log(`✅ Image saved locally at: ${filePath}`);
        savedFiles.push(filePath);

        // Create proper data URI
        const dataUri = `data:${mimeType};base64,${imageData}`;

        // Upload image to your endpoint
        console.log(`🚀 Uploading image ${index} to server...`);
        
        try {
          const uploadResult = await uploadBase64Image(dataUri);

          if (uploadResult.success && uploadResult.url) {
            console.log(
              `✅ Image ${index} uploaded successfully: ${uploadResult.url}`
            );
            uploadedUrls.push(uploadResult.url);

            // Store successful upload in database
            if (sessionId && messageId) {
              try {
                const dbResult = await storeImageInDatabase(
                  sessionId,
                  messageId,
                  description,
                  uploadResult.url,
                  subject,
                  true, // success = true
                  null, // no error
                  lessonId,
                  null // revisedPrompt
                );
                console.log(
                  `✅ Image ${index} stored in database with ID: ${dbResult}, URL: ${uploadResult.url}`
                );
              } catch (dbError) {
                console.error(
                  `❌ Failed to store image ${index} in database:`,
                  dbError.message
                );
              }
            }
          } else {
            console.error(
              `❌ Failed to upload image ${index}:`,
              uploadResult.error || "Unknown upload error"
            );
            
            // Store upload failure in database
            if (sessionId && messageId) {
              try {
                await storeImageInDatabase(
                  sessionId,
                  messageId,
                  description,
                  null, // no URL since upload failed
                  subject,
                  false, // success = false
                  uploadResult.error || "Upload failed",
                  lessonId,
                  null
                );
              } catch (dbError) {
                console.error(
                  `❌ Failed to store upload error in database:`,
                  dbError.message
                );
              }
            }
          }
        } catch (uploadError) {
          console.error(`❌ Upload error for image ${index}:`, uploadError.message);
          
          // Store upload exception in database
          if (sessionId && messageId) {
            try {
              await storeImageInDatabase(
                sessionId,
                messageId,
                description,
                null,
                subject,
                false,
                uploadError.message,
                lessonId,
                null
              );
            } catch (dbError) {
              console.error(`❌ Failed to store upload exception in database:`, dbError.message);
            }
          }
        }

        // Save full base64 string to separate file (for debugging)
        try {
          const base64LogPath = path.join(
            "./outputs",
            `${safeName}-${index}-base64.txt`
          );
          await fs.writeFile(base64LogPath, dataUri);
          console.log(`📄 Full Base64 data URI logged at: ${base64LogPath}`);
        } catch (logError) {
          console.warn(`⚠️ Failed to save base64 log:`, logError.message);
        }

        index++;
      }
    }

    // ✅ Check if we have any successful uploads
    if (uploadedUrls.length === 0) {
      throw new Error("❌ No images were successfully uploaded");
    }

    return {
      success: true,
      filePaths: savedFiles,
      uploadedUrls: uploadedUrls,
      originalDescription: description,
    };
    
  } catch (err) {
    console.error("❌ Generation failed:", err.message || err);

    // Store generation failure in database if database params are provided
    if (sessionId && messageId) {
      try {
        await storeImageInDatabase(
          sessionId,
          messageId,
          description,
          null, // no URL since generation failed
          subject,
          false, // success = false
          err.message || err.toString(),
          lessonId,
          null
        );
        console.log("💾 Stored generation failure in database");
      } catch (dbError) {
        console.error(
          `❌ Failed to store generation error in database:`,
          dbError.message
        );
      }
    }

    return {
      success: false,
      error: err.message || err.toString(),
      originalDescription: description,
      filePaths: [],
      uploadedUrls: [],
    };
  }
};

const storeImageInDatabase = async (
  sessionId,
  messageId,
  description,
  imageUrl,
  subject,
  success,
  errorMessage = null,
  lessonId = null,
  revisedPrompt = null
) => {
  let connection;
  try {
    // 🔍 DEBUG: Log what we received
    console.log("🔍 DEBUG - storeImageInDatabase received:", {
      imageUrl: imageUrl,
      imageUrlType: typeof imageUrl,
      imageUrlLength: imageUrl ? imageUrl.length : "null",
      imageUrlStartsWith: imageUrl ? imageUrl.substring(0, 50) : "null",
    });

    // Get a dedicated connection
    connection = await pool.getConnection();

    // Normalize success for MySQL (boolean → tinyint)
    const successFlag = success ? 1 : 0;

    // imageUrl is now already the full HTTP URL from your upload endpoint
    // No need for complex URL processing anymore
    const actualImageUrl = imageUrl;

    // ✅ Ensure ALL fields are properly typed and not undefined
    const safeValues = [
      sessionId != null ? Number(sessionId) : null,
      lessonId != null ? Number(lessonId) : null,
      messageId != null ? String(messageId) : null,
      description != null ? String(description) : null,
      actualImageUrl,
      subject != null ? String(subject) : null,
      successFlag,
      errorMessage != null ? String(errorMessage) : null,
      revisedPrompt != null ? String(revisedPrompt) : null,
    ];

    // Debug log to see what we're inserting
    console.log(
      "🔍 Safe values for DB insert:",
      safeValues.map((val, idx) => {
        const fieldNames = [
          "session_id",
          "lesson_id",
          "message_id",
          "description",
          "image_url",
          "subject",
          "success",
          "error_message",
          "revised_prompt",
        ];
        return {
          field: fieldNames[idx],
          index: idx,
          type: typeof val,
          isNull: val === null,
          isUndefined: val === undefined,
          value:
            val === null
              ? "NULL"
              : val === undefined
              ? "UNDEFINED"
              : typeof val === "string" && val.length > 50
              ? val.substring(0, 50) + "..."
              : val,
        };
      })
    );

    // Insert into DB with explicit connection
    const [result] = await connection.query(
      `INSERT INTO generated_diagrams 
       (session_id, lesson_id, message_id, description, image_url, subject, success, error_message, revised_prompt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      safeValues
    );

    console.log(
      `✅ Stored diagram in database → ID: ${result.insertId}, lesson_id: ${lessonId}, success: ${success}, image_url: ${actualImageUrl}`
    );

    return result.insertId;
  } catch (error) {
    console.error("❌ Error storing image in database:", {
      error: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      // Log the problematic values for debugging
      sessionId: typeof sessionId,
      lessonId: typeof lessonId,
      messageId: typeof messageId,
      description: typeof description,
      imageUrl: typeof imageUrl,
      subject: typeof subject,
      success: typeof success,
      errorMessage: typeof errorMessage,
      revisedPrompt: typeof revisedPrompt,
    });
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};



const processVisualRequests = async (content) => {
  const visualRegex = /\[CreateVisual: "(.*?)"\]/g;
  let matches;
  const visualPromises = [];

  // Find all visual requests in the content
  while ((matches = visualRegex.exec(content)) !== null) {
    const [fullMatch, description] = matches;
    visualPromises.push(
      generateDiagram(description).then(result => ({
        original: fullMatch,
        replacement:
          result.success && result.uploadedUrls.length > 0
            ? `<img src="${result.uploadedUrls[0]}" alt="${description}" class="math-diagram">`
            : ""
      }))
    );
  }

  // Wait for all images to generate
  const results = await Promise.all(visualPromises);

  // Replace visual markers with image tags
  let processedContent = content;
  results.forEach(({ original, replacement }) => {
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



function cleanAssistantResponse(raw) {
  if (!raw) return "";

  // Split by --- sections
  const blocks = raw.split(/---+/);

  // Always keep first block (metadata + welcome)
  let cleaned = blocks[0].trim();

  // Keep only blocks with questions
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].includes("📝 QUESTION")) {
      cleaned += "\n\n---\n" + blocks[i].trim();
    }
  }

  return cleaned;
}




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
let processedContent = cleanAssistantResponse(assistantResponse);

// Process visual requests in the response
if (assistantResponse) {
  const containsCreateVisual = assistantResponse.includes("CreateVisual:");
  const containsImage = /<img\s+src=/.test(assistantResponse);

  if (containsCreateVisual || containsImage) {
    console.log("🎨 Processing visual content...");
    hasVisuals = true;
    processedContent = await processVisualRequests(processedContent);
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
