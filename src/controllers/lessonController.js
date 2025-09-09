const axios = require("axios");
const mysql = require("mysql2/promise");
const path = require("path");
const { VertexAI } = require("@google-cloud/vertexai");
const fs = require("fs/promises");
const Replicate = require("replicate");
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
const PROMPT_API_URL = "https://node.tutoh.ai/api/get-prompt/";
console.log(
  "=============> process.env.GOOGLE_API_KEY =================>" +
    process.env.GOOGLE_API_KEY
);
const fetchPromptFromAPI = async (subject, type) => {
  try {
    const response = await axios.get(
      `${PROMPT_API_URL}${encodeURIComponent(subject)}/${encodeURIComponent(
        type
      )}`
    );

    if (response.data.success && response.data.data?.prompt) {
      return response.data.data.prompt;
    } else {
      throw new Error(
        `Prompt not found for subject "${subject}" and type "${type}"`
      );
    }
  } catch (error) {
    console.error(`❌ Error fetching prompt:`, error.message);
    throw error;
  }
};

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(
  __dirname,
  "freeze-app-ed1c8a99cf24.json"
);

const ai = new GoogleGenAI({
  project: "freeze-app",
  location: "us-central1",
});

const model = "gemini-2.5-pro";

const fetch =
  global.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args)));

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
      "https://thinkdream.in/GCSE/api/upload-base64-image",
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

    console.log("🧠 Generating with Gemini Nano AI, prompt:", description);

    const ai = new GoogleGenAI({});

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
        const uploadResult = await uploadBase64Image(dataUri);

        if (uploadResult.success) {
          console.log(
            `✅ Image ${index} uploaded successfully: ${uploadResult.url}`
          );
          uploadedUrls.push(uploadResult.url);

          // Store in database with the uploaded URL
          if (sessionId && messageId) {
            try {
              const dbResult = await storeImageInDatabase(
                sessionId,
                messageId,
                description,
                uploadResult.url, // ✅ This should be the uploaded URL from your endpoint
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
                dbError
              );
            }
          }
        } else {
          console.error(
            `❌ Failed to upload image ${index}:`,
            uploadResult.error
          );
          // Store error in database if database params are provided
          if (sessionId && messageId) {
            try {
              await storeImageInDatabase(
                sessionId,
                messageId,
                description,
                null, // no URL since upload failed
                subject,
                false, // success = false
                uploadResult.error,
                lessonId,
                null
              );
            } catch (dbError) {
              console.error(
                `❌ Failed to store upload error in database:`,
                dbError
              );
            }
          }
        }

        // Save full base64 string to separate file (for debugging)
        const base64LogPath = path.join(
          "./outputs",
          `${safeName}-${index}-base64.txt`
        );
        await fs.writeFile(base64LogPath, dataUri);
        console.log(`📄 Full Base64 data URI logged at: ${base64LogPath}`);

        index++;
      }
    }

    if (savedFiles.length === 0) {
      throw new Error("❌ No image data found in Gemini response");
    }

    return {
      success: true,
      filePaths: savedFiles,
      uploadedUrls: uploadedUrls,
      originalDescription: description,
    };
  } catch (err) {
    console.error("❌ Generation failed:", err.message || err);

    // Store error in database if database params are provided
    if (sessionId && messageId) {
      try {
        await storeImageInDatabase(
          sessionId,
          messageId,
          description,
          null, // no URL since generation failed
          subject,
          false, // success = false
          err.message || err,
          lessonId,
          null
        );
      } catch (dbError) {
        console.error(
          `❌ Failed to store generation error in database:`,
          dbError
        );
      }
    }

    return {
      success: false,
      error: err.message || err,
      originalDescription: description,
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

// Enhanced function to process lesson content with better image handling
const processLessonContent = async (
  content,
  subject,
  sessionId = null,
  messageId = null,
  connection = null,
  lessonId = null
) => {
  let localConnection = null;
  let shouldReleaseConnection = false;

  try {
    console.log("🔥 processLessonContent CALLED");
    console.log("📏 Content length:", content?.length);
    console.log("📜 Subject received:", subject);
    console.log("🎯 Lesson ID:", lessonId);

    // ✅ Use caller’s connection or open a new one
    if (connection) {
      localConnection = connection;
      shouldReleaseConnection = false;
    } else {
      localConnection = await pool.getConnection();
      shouldReleaseConnection = true;
    }

    const inlinePattern = /\[CreateVisual:\s*["'](.+?)["']\]/g;
    const blockPattern = /CreateVisual:\s*([\s\S]+?)(?=\n\n|$)/gi;

    let processedContent = content;
    const allMatches = [];

    // Inline matches
    for (const match of content.matchAll(inlinePattern)) {
      let description = match[1].trim().replace(/\s+/g, " ");
      allMatches.push({ fullMatch: match[0], description, subject });
    }

    // Block matches
    for (const match of content.matchAll(blockPattern)) {
      const block = match[1].trim();
      const subjectMatch = block.match(/Subject:\s*{?([^};\n]+)}?/i);
      const topicMatch = block.match(/Topic:\s*{?([^};\n]+)}?/i);
      const focusMatch = block.match(/Focus:\s*{?([^};\n]+)}?/i);

      let description = focusMatch
        ? focusMatch[1].trim()
        : topicMatch
        ? topicMatch[1].trim()
        : null;

      let subjectOverride = subjectMatch ? subjectMatch[1].trim() : null;

      if (description) {
        const finalSubject = subjectOverride || subject;
        allMatches.push({
          fullMatch: match[0],
          description: description.replace(/\s+/g, " "),
          subject: finalSubject,
        });
      }
    }

    console.log(`🧪 Total visuals to generate: ${allMatches.length}`);

    for (const {
      fullMatch,
      description,
      subject: effectiveSubject,
    } of allMatches) {
      console.log(
        `🎯 Handling diagram for: "${description}" [Subject: ${effectiveSubject}, Lesson: ${lessonId}]`
      );

      let diagramResult;
      let diagramIds = [];
      let diagramUrls = [];

      // ✅ Cache check
      if (localConnection && lessonId) {
        try {
          const [rows] = await localConnection.query(
            `SELECT id, image_url
             FROM generated_diagrams
             WHERE lesson_id = ? AND description = ? AND success = 1
             ORDER BY generation_time DESC`,
            [lessonId, description]
          );

          if (rows.length > 0) {
            console.log(
              `📂 Found ${rows.length} cached images for Lesson=${lessonId}, using existing.`
            );
            diagramResult = { success: true };
            diagramIds = rows.map((r) => r.id);
            diagramUrls = rows.map((r) => r.image_url);
          }
        } catch (cacheError) {
          console.warn("⚠️ Lesson cache check failed:", cacheError.message);
        }
      }

      // Generate new if no cache
      if (!diagramResult) {
        console.log(`⚙️ Generating new diagram(s) for "${description}"`);
        diagramResult = await generateDiagram(description, effectiveSubject);

        if (diagramResult.success && sessionId && localConnection) {
          for (const [
            idx,
            uploadedUrl,
          ] of diagramResult.uploadedUrls.entries()) {
            try {
              const id = await storeImageInDatabase(
                sessionId,
                messageId || null,
                description,
                uploadedUrl,
                effectiveSubject,
                true,
                null,
                lessonId,
                null
              );
              diagramIds.push(id);
              diagramUrls.push(uploadedUrl);
              console.log(
                `💾 Stored new diagram in DB: ID=${id}, Lesson=${lessonId}, URL=${uploadedUrl}`
              );
            } catch (dbError) {
              console.warn("⚠️ DB Store Error:", dbError.message);
            }
          }
        }
      }

      // Replace placeholders
      if (diagramResult?.success) {
        let diagramsHtml = "";

        diagramUrls.forEach((url, idx) => {
          diagramsHtml += `
          <div class="lesson-diagram" 
               style="margin: 20px 0; text-align: center; border: 2px solid #e0e0e0; border-radius: 12px; padding: 15px; background: #f9f9f9;" 
               data-diagram-id="${diagramIds[idx] || ""}" 
               data-lesson-id="${lessonId}"
               data-description="${description.replace(/"/g, "&quot;")}"
               data-subject="${effectiveSubject}">
            <h4 style="color: #333; margin-bottom: 10px; font-size: 16px;">${description} (${
            idx + 1
          })</h4>
            <img src="${url}" 
                 alt="Educational diagram: ${description}" 
                 style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <div style="display: none; padding: 20px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24;">
              <p style="margin: 0; font-weight: bold;">📊 Diagram: ${description}</p>
              <p style="margin: 5px 0 0 0; font-size: 12px;">Image could not be loaded</p>
            </div>
            <p style="font-style: italic; color: #666; margin-top: 10px; font-size: 12px;">
              Subject: ${
                effectiveSubject.charAt(0).toUpperCase() +
                effectiveSubject.slice(1)
              }
            </p>
          </div>`;
        });

        processedContent = processedContent.replace(fullMatch, diagramsHtml);
        console.log(
          `✅ Inserted ${diagramUrls.length} diagram(s) for: ${description}`
        );
      }
    }

    return processedContent;
  } catch (error) {
    console.error("🚨 Visual processing error:", error);
    return content;
  } finally {
    if (shouldReleaseConnection && localConnection) {
      try {
        localConnection.release();
        console.log("🔌 Released local database connection (internal)");
      } catch (releaseError) {
        console.warn(
          "⚠️ Error releasing local connection:",
          releaseError.message
        );
      }
    } else {
      console.log(
        "🔄 Skipped releasing connection (external one still in use)"
      );
    }
  }
};

// Check if database columns exist
const checkDatabaseColumns = async (connection) => {
  try {
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'session_messages'
    `);

    const columnNames = columns.map((col) => col.COLUMN_NAME);

    return {
      hasProcessedContent: columnNames.includes("processed_content"),
      hasVisuals: columnNames.includes("has_visuals"),
    };
  } catch (error) {
    console.error("Error checking database columns:", error);
    return { hasProcessedContent: false, hasVisuals: false };
  }
};

// Enhanced database initialization with better diagram storage
const initializeDatabase = async () => {
  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Create tutoring_sessions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tutoring_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(100) NOT NULL,
        student_name VARCHAR(100) NOT NULL,
        subject VARCHAR(50) NOT NULL,
        exam_board VARCHAR(50) NOT NULL,
        tier VARCHAR(20) NOT NULL,
        lesson_topic_code VARCHAR(50) NOT NULL,
        lesson_topic VARCHAR(100) NOT NULL,
        lesson_start_time DATETIME,
        lesson_end_time DATETIME,
        lesson_status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_session (student_id, subject(50), exam_board(20), tier(10), lesson_topic_code(20), lesson_topic(50))
      ) ENGINE=InnoDB
    `);

    // 2. Create session_messages table with all columns
    await connection.query(`
      CREATE TABLE IF NOT EXISTS session_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        role ENUM('system', 'user', 'assistant') NOT NULL,
        content TEXT NOT NULL,
        processed_content LONGTEXT NULL,
        has_visuals BOOLEAN DEFAULT FALSE,
        timestamp VARCHAR(50),
        message_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session_timestamp (session_id, timestamp),
        INDEX idx_session_id (session_id)
      ) ENGINE=InnoDB
    `);

    // 3. Check if new columns exist and add them if they don't
    const columnCheck = await checkDatabaseColumns(connection);

    if (!columnCheck.hasProcessedContent) {
      await connection.query(`
        ALTER TABLE session_messages 
        ADD COLUMN processed_content LONGTEXT NULL
      `);
      console.log("✅ Added processed_content column");
    }

    if (!columnCheck.hasVisuals) {
      await connection.query(`
        ALTER TABLE session_messages 
        ADD COLUMN has_visuals BOOLEAN DEFAULT FALSE
      `);
      console.log("✅ Added has_visuals column");
    }

    // 4. Enhanced generated_diagrams table with better storage
    await connection.query(`
  CREATE TABLE IF NOT EXISTS generated_diagrams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    lesson_id INT NULL,  -- NEW: Add lesson_id column
    message_id VARCHAR(100),
    description TEXT NOT NULL,
    image_url VARCHAR(1000),
    revised_prompt TEXT,
    subject VARCHAR(50),
    generation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    expires_at TIMESTAMP NULL,
    is_persistent BOOLEAN DEFAULT TRUE,
    INDEX idx_session_id (session_id),
    INDEX idx_lesson_id (lesson_id),  -- NEW: Add index for lesson_id
    INDEX idx_expires_at (expires_at),
    INDEX idx_generation_time (generation_time)
  ) ENGINE=InnoDB
`);

    // NEW: Check if lesson_id column exists and add it if missing
    const [diagramColumns] = await connection.query(`
  SELECT COLUMN_NAME 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'generated_diagrams' 
  AND COLUMN_NAME = 'lesson_id'
`);

    if (diagramColumns.length === 0) {
      await connection.query(`
    ALTER TABLE generated_diagrams 
    ADD COLUMN lesson_id INT NULL,
    ADD INDEX idx_lesson_id (lesson_id)
  `);
      console.log("✅ Added lesson_id column to generated_diagrams table");
    }

    // 5. Create image_cache table for better persistence
    // await connection.query(`
    //   CREATE TABLE IF NOT EXISTS image_cache (
    //     id INT AUTO_INCREMENT PRIMARY KEY,
    //     original_url VARCHAR(1000) NOT NULL,
    //     cached_url VARCHAR(1000),
    //     description TEXT,
    //     subject VARCHAR(50),
    //     file_size INT,
    //     mime_type VARCHAR(50),
    //     cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    //     last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    //     access_count INT DEFAULT 0,
    //     is_valid BOOLEAN DEFAULT TRUE,
    //     UNIQUE KEY unique_original_url (original_url(255))
    //   ) ENGINE=InnoDB
    // `);

    // 6. Create lesson_data table with all columns including diagrams_generated
    await connection.query(`
  CREATE TABLE IF NOT EXISTS lesson_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT,
    student_id VARCHAR(100) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    science_discipline TEXT,
    exam_board VARCHAR(50),
    tier VARCHAR(20),
    lesson_topic_code VARCHAR(50),
    lesson_topic VARCHAR(100),
    lesson_run_mode ENUM('autopilot', 'manual', 'assisted'),
    lesson_status ENUM('complete', 'incomplete'),
    lesson_start_time DATETIME,
    lesson_end_time DATETIME,
    lesson_duration_minutes INT,
    student_start_time DATETIME,
    student_end_time DATETIME,
    student_total_duration_minutes INT,
    designed_pacing_minutes INT,
    
    -- Performance & Evaluation Scores
    lesson_quality_score INT,
    student_engagement_score INT,
    comprehension_score INT,
    knowledge_gain_estimate INT,
    
    -- Quiz Results
    quiz_score INT,
    quiz_score_total INT,
    quiz_score_percent VARCHAR(10),
    quiz_question_topics JSON,
    
    -- Socratic Results
    socratic_score INT,
    socratic_score_reasoning TEXT,
    socratic_prompt TEXT,
    socratic_response TEXT,
    
    -- GPT Meta
    regeneration_count INT,
    regeneration_maxed BOOLEAN,
    lesson_quality_commentary TEXT,
    
    -- Student Profile Echo
    student_confidence_level ENUM('High', 'Medium', 'Low'),
    student_progress_trend ENUM('Improving', 'Stagnant', 'Declining'),
    average_subject_score VARCHAR(20),
    predicted_grade VARCHAR(20),
    student_summary TEXT,
    
    -- Token and Cost Tracking
    estimated_tokens_used INT,
    estimated_cost_usd FLOAT,
    estimated_cost_usd_formatted VARCHAR(20),
    estimated_cost_gbp_formatted VARCHAR(20),
    cost_per_input_token_usd FLOAT,
    cost_per_output_token_usd FLOAT,
    cost_per_input_token_gbp FLOAT,
    cost_per_output_token_gbp FLOAT,
    
    -- Full Archive
    full_chat_transcript LONGTEXT,
    
    diagrams_generated INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES tutoring_sessions(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

    // Check if diagrams_generated column exists in lesson_data and add if missing
    const [lessonDataColumns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'lesson_data' 
      AND COLUMN_NAME = 'diagrams_generated'
    `);

    if (lessonDataColumns.length === 0) {
      await connection.query(`
        ALTER TABLE lesson_data 
        ADD COLUMN diagrams_generated INT DEFAULT 0
      `);
      console.log("✅ Added diagrams_generated column to lesson_data table");
    }

    // Add foreign key constraints
    const [existingConstraints] = await connection.query(`
      SELECT CONSTRAINT_NAME 
      FROM information_schema.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'session_messages' 
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND CONSTRAINT_NAME = 'fk_session_id'
    `);

    if (existingConstraints.length === 0) {
      try {
        await connection.query(`
          ALTER TABLE session_messages
          ADD CONSTRAINT fk_session_id
          FOREIGN KEY (session_id) REFERENCES tutoring_sessions(id) ON DELETE CASCADE
        `);
        console.log("✅ Foreign key constraint added successfully");
      } catch (fkError) {
        console.warn("⚠️ Foreign key constraint failed:", fkError.message);
      }
    }

    console.log("✅ Database tables initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Call initialization when module loads
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

    // Set up Gemini config
    const generationConfig = {
      maxOutputTokens: 65535,
      temperature: 1,
      topP: 0.95,
      seed: 0,
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    const chat = ai.chats.create({ model, config: generationConfig });
    console.log("🤖 Chat session created with Gemini AI");

    const messageContent = JSON.stringify({
      ...userLessonInput,
      student_response: messages[messages.length - 1]?.content || "",
    });

    console.log("📤 Sending message to Gemini:", messageContent);

    // Request Gemini response (non-streaming)
    const response = await chat.sendMessage({
      message: { text: messageContent },
    });

    // 🚨 Log the full response for debugging
    console.log("📥 Gemini raw response:", JSON.stringify(response, null, 2));

    // ✅ Extract assistant text safely
    let assistantContent =
      response?.output_text ||
      response?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("\n") ||
      "";

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
        connection, // ✅ reuse the same connection
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

      let insertQuery = `INSERT INTO session_messages (session_id, role, content, timestamp, message_id, student_id`;
      let insertValues = [
        sessionId,
        assistantMessage.role,
        assistantMessage.content,
        assistantMessage.timestamp,
        assistantMessage.id,
        student_id,
      ];

      if (columnCheck.hasProcessedContent) {
        insertQuery += `, processed_content`;
        insertValues.push(assistantMessage.processed_content);
      }
      if (columnCheck.hasVisuals) {
        insertQuery += `, has_visuals`;
        insertValues.push(assistantMessage.has_visuals);
      }

      // 🔎 Optionally store raw Gemini JSON for debugging (if your DB schema allows)
      if (columnCheck.hasRawResponse) {
        insertQuery += `, raw_response`;
        insertValues.push(JSON.stringify(response));
      }

      insertQuery += `) VALUES (?, ?, ?, ?, ?, ?`;
      if (columnCheck.hasProcessedContent) insertQuery += `, ?`;
      if (columnCheck.hasVisuals) insertQuery += `, ?`;
      if (columnCheck.hasRawResponse) insertQuery += `, ?`;
      insertQuery += `)`;

      await connection.query(insertQuery, insertValues);
    } else {
      console.warn("⚠️ No assistant content returned from Gemini");
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
        console.warn("⚠️ Tried releasing connection twice");
      }
    }
  }
};

// Add function to get lesson history
const getLessonHistory = async (req, res) => {
  let connection;
  try {
    const {
      student_id,
      subject,
      exam_board,
      tier,
      lesson_topic_code,
      lesson_topic,
    } = req.query;

    if (!student_id) {
      return res
        .status(400)
        .json({ success: false, error: "student_id is required" });
    }

    connection = await pool.getConnection();

    // Check database columns availability
    const columnCheck = await checkDatabaseColumns(connection);

    let query = `SELECT ts.*, 
                (SELECT COUNT(*) FROM session_messages sm WHERE sm.session_id = ts.id) AS message_count
                FROM tutoring_sessions ts 
                WHERE ts.student_id = ?`;
    let params = [student_id];

    // Add optional filters
    if (subject) {
      query += ` AND ts.subject = ?`;
      params.push(subject);
    }
    if (exam_board) {
      query += ` AND ts.exam_board = ?`;
      params.push(exam_board);
    }
    if (tier) {
      query += ` AND ts.tier = ?`;
      params.push(tier);
    }
    if (lesson_topic_code) {
      query += ` AND ts.lesson_topic_code = ?`;
      params.push(lesson_topic_code);
    }
    if (lesson_topic) {
      query += ` AND ts.lesson_topic = ?`;
      params.push(lesson_topic);
    }

    query += ` ORDER BY ts.created_at DESC`;

    const [sessions] = await connection.query(query, params);

    // For each session, get messages if requested
    if (req.query.include_messages === "true") {
      for (let session of sessions) {
        // Build message query dynamically based on available columns
        let messageQuery = `SELECT role, `;

        if (columnCheck.hasVisuals && columnCheck.hasProcessedContent) {
          messageQuery += `
            CASE 
              WHEN has_visuals = 1 AND processed_content IS NOT NULL 
              THEN processed_content 
              ELSE content 
            END as content,
            timestamp, 
            message_id AS id,
            has_visuals`;
        } else {
          messageQuery += `content, timestamp, message_id AS id`;
          if (columnCheck.hasVisuals) {
            messageQuery += `, has_visuals`;
          }
        }

        messageQuery += ` FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC`;

        const [messages] = await connection.query(messageQuery, [session.id]);
        session.messages = messages;
      }
    }

    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error("Get Lesson History Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Add function to save lesson data
const saveLessonData = async (req, res) => {
  let connection;
  try {
    const lessonData = req.body;

    // Validate required fields
    if (
      !lessonData.student_id ||
      !lessonData.student_name ||
      !lessonData.subject
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    connection = await pool.getConnection();

    // Count generated diagrams (optional)
    let diagramCount = 0;
    if (lessonData.session_id) {
      try {
        const [diagramResult] = await connection.query(
          `SELECT COUNT(*) as count FROM generated_diagrams WHERE session_id = ? AND success = 1`,
          [lessonData.session_id]
        );
        diagramCount = diagramResult[0].count;
      } catch (diagramError) {
        console.warn(
          "Could not count diagrams, setting to 0:",
          diagramError.message
        );
      }
    }

    // Helper: convert JS Date or ISO string to MySQL DATETIME
    const toMySQLDateTime = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 19).replace("T", " ");
    };

    // Prepare the data for insertion
    const insertData = {
      session_id: lessonData.session_id || null,
      student_id: lessonData.student_id,
      student_name: lessonData.student_name,
      subject: lessonData.subject,
      science_discipline: lessonData.science_discipline || null,
      exam_board: lessonData.exam_board || null,
      tier: lessonData.tier || null,
      lesson_topic_code: lessonData.lesson_topic_code || null,
      lesson_topic: lessonData.lesson_topic || null,
      lesson_run_mode: lessonData.lesson_run_mode || null,
      lesson_status: lessonData.lesson_status || null,
      lesson_start_time: toMySQLDateTime(
        lessonData.lesson_start_time || new Date()
      ),
      lesson_end_time: toMySQLDateTime(lessonData.lesson_end_time),
      lesson_duration_minutes: lessonData.lesson_duration_minutes || null,
      student_start_time: toMySQLDateTime(lessonData.student_start_time),
      student_end_time: toMySQLDateTime(lessonData.student_end_time),
      student_total_duration_minutes:
        lessonData.student_total_duration_minutes || null,
      designed_pacing_minutes: lessonData.designed_pacing_minutes || null,
      lesson_quality_score: lessonData.lesson_quality_score || null,
      student_engagement_score: lessonData.student_engagement_score || null,
      comprehension_score: lessonData.comprehension_score || null,
      knowledge_gain_estimate: lessonData.knowledge_gain_estimate || null,
      quiz_score: lessonData.quiz_score || null,
      quiz_score_total: lessonData.quiz_score_total || null,
      quiz_score_percent: lessonData.quiz_score_percent || null,
      quiz_question_topics: lessonData.quiz_question_topics
        ? JSON.stringify(lessonData.quiz_question_topics)
        : null,
      socratic_score: lessonData.socratic_score || null,
      socratic_score_reasoning: lessonData.socratic_score_reasoning || null,
      socratic_prompt: lessonData.socratic_prompt || null,
      socratic_response: lessonData.socratic_response || null,
      regeneration_count: lessonData.regeneration_count || null,
      regeneration_maxed: lessonData.regeneration_maxed || null,
      lesson_quality_commentary: lessonData.lesson_quality_commentary || null,
      student_confidence_level: lessonData.student_confidence_level,
      student_progress_trend: lessonData.student_progress_trend,
      average_subject_score: lessonData.average_subject_score || null,
      predicted_grade: lessonData.predicted_grade || null,
      student_summary: lessonData.student_summary || null,
      estimated_tokens_used: lessonData.estimated_tokens_used || null,
      estimated_cost_usd: lessonData.estimated_cost_usd || null,
      estimated_cost_usd_formatted:
        lessonData.estimated_cost_usd_formatted || null,
      estimated_cost_gbp_formatted:
        lessonData.estimated_cost_gbp_formatted || null,
      cost_per_input_token_usd: lessonData.cost_per_input_token_usd || null,
      cost_per_output_token_usd: lessonData.cost_per_output_token_usd || null,
      cost_per_input_token_gbp: lessonData.cost_per_input_token_gbp || null,
      cost_per_output_token_gbp: lessonData.cost_per_output_token_gbp || null,
      full_chat_transcript: lessonData.full_chat_transcript || null,
      diagrams_generated: diagramCount,
    };

    // Insert into DB
    const [result] = await connection.query(`INSERT INTO lesson_data SET ?`, [
      insertData,
    ]);

    res.json({
      success: true,
      data: {
        data: insertData,
        id: result.insertId,
        diagrams_generated: diagramCount,
      },
    });
  } catch (error) {
    console.error("❌ Error saving lesson data:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  startLesson,
  getLessonHistory,
  saveLessonData,
  generateDiagram,
};
