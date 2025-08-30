const axios = require("axios");
const mysql = require("mysql2/promise");
const path = require("path");
const { VertexAI } = require("@google-cloud/vertexai");
const fs = require("fs/promises");
const Replicate = require("replicate");

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
const PROMPT_API_URL = "https://laravel.tutoh.ai/api/get-prompt/";
console.log(
  "=============> process.env.OPENAI_API_KEY =================>" +
    process.env.OPENAI_API_KEY
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

// // ✅ Google Cloud settings
// const PROJECT_ID = "dreams-review-api";
// const LOCATION = "us-central1";

// // ✅ Create Vertex AI client
// const vertexAI = new VertexAI({
//   project: PROJECT_ID,
//   location: LOCATION,
// });

// // ✅ Generate diagram using Imagen-4
// const generateDiagram = async (description) => {
//   try {
//    const model = vertexAI.getGenerativeModel({
//   model: "imagegeneration@002",  // ✅ This maps to Imagen 2
//   publisher: "google",
// });

//     const request = {
//       contents: [
//         {
//           role: "user",
//           parts: [{ text: description }],
//         },
//       ],
//     };

//     const result = await model.generateContent(request);

//     const imagePart = result.response.candidates?.[0]?.content?.parts?.find(
//       (part) => part.inlineData?.mimeType === "image/png"
//     );

//     if (!imagePart) {
//       throw new Error("❌ No image returned from Imagen-4.");
//     }

//     const buffer = Buffer.from(imagePart.inlineData.data, "base64");
//     const outputDir = path.resolve(__dirname, "../outputs");

//     if (!fs.existsSync(outputDir)) {
//       fs.mkdirSync(outputDir, { recursive: true });
//     }

//     const outputPath = path.join(outputDir, `image-${Date.now()}.png`);
//     fs.writeFileSync(outputPath, buffer);

//     console.log("✅ Image saved at", outputPath);

//     return {
//       success: true,
//       filePath: outputPath,
//       originalDescription: description,
//     };
//   } catch (error) {
//     console.error("❌ Vertex AI (Imagen-4) Error:", error.message);
//     return {
//       success: false,
//       error: error.message,
//       originalDescription: description,
//     };
//   }
// };

const fetch =
  global.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args)));

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

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

const generateDiagram = async (description, imageName = "") => {
  try {
    if (!description || description.trim().length === 0) {
      throw new Error("❌ Description is required to generate a diagram");
    }

    console.log("🧠 Generating with prompt:", description);

    const input = {
      prompt: description,
      aspect_ratio: "3:2",
      output_format: "webp",
      output_quality: 80,
      safety_tolerance: 2,
      prompt_upsampling: true,
    };

    console.log("📥 Input payload:", JSON.stringify(input, null, 2));

    // Run Flux 1.1 Pro
    const output = await replicate.run("black-forest-labs/flux-1.1-pro", {
      input,
    });

    console.log("📦 Raw output type:", typeof output);
    console.log("📦 Raw output constructor:", output?.constructor?.name);
    console.log("📦 Full raw output:", JSON.stringify(output, null, 2));

    if (!output) {
      throw new Error("❌ No output returned from Replicate");
    }

    // Resolve image URL
    let imageUrl;
    if (typeof output.url === "function") {
      const maybeUrl = output.url();
      imageUrl = maybeUrl instanceof URL ? maybeUrl.toString() : maybeUrl;
      console.log("🔗 Using output.url():", imageUrl);
    } else if (output.output) {
      imageUrl = output.output;
      console.log("🔗 Using output.output:", imageUrl);
    } else {
      imageUrl = output;
      console.log("🔗 Using raw output as URL:", imageUrl);
    }

    if (!imageUrl || typeof imageUrl !== "string") {
      throw new Error("❌ Invalid image URL returned");
    }

    console.log("🌐 Final resolved Image URL:", imageUrl);

    // Download image
    console.log("📡 Downloading image...");
    const res = await fetch(imageUrl);

    if (!res.ok) {
      throw new Error(
        `❌ Failed to fetch image: ${res.status} ${res.statusText}`
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`📏 Downloaded image buffer size: ${buffer.length} bytes`);

    await ensureOutputDir();
    const timestamp = Date.now();

    // Build safe filename
    const baseName =
      imageName ||
      sanitizeFilename(description).slice(0, 50) ||
      `diagram-${timestamp}`;
    const safeName = sanitizeFilename(baseName);

    // Detect extension from URL
    const ext = path.extname(new URL(imageUrl).pathname) || ".webp";

    const filePath = `./outputs/${safeName}${ext}`;

    await fs.writeFile(filePath, buffer);

    console.log("✅ Image saved at:", filePath);

    return {
      success: true,
      imageUrl,
      filePath,
      rawOutput: output,
      originalDescription: description,
    };
  } catch (err) {
    console.error("❌ Generation failed:", err.message || err);
    return {
      success: false,
      error: err.message || err,
      originalDescription: description,
    };
  }
};

// 2. UPDATE: storeImageInDatabase function to include lesson_id
const storeImageInDatabase = async (
  sessionId,
  messageId,
  description,
  imageUrl,
  subject,
  success,
  errorMessage = null,
  connection = null,
  lessonId = null // NEW: Add lessonId parameter
) => {
  let shouldReleaseConnection = false;

  try {
    // Use provided connection or get new one
    if (!connection) {
      connection = await pool.getConnection();
      shouldReleaseConnection = true;
    }

    // Handle different imageUrl types more safely
    let actualImageUrl = null;

    if (imageUrl) {
      if (typeof imageUrl === "string") {
        actualImageUrl = imageUrl;
      } else if (typeof imageUrl === "object") {
        // Check if it's a ReadableStream or other object
        if (imageUrl.constructor?.name === "ReadableStream") {
          console.warn(
            "⚠️ Cannot store ReadableStream in database, setting to null"
          );
          actualImageUrl = null;
        } else {
          console.warn(
            "⚠️ Unknown imageUrl object type:",
            imageUrl.constructor?.name
          );
          actualImageUrl = null;
        }
      } else {
        console.warn("⚠️ Invalid imageUrl type:", typeof imageUrl);
        actualImageUrl = null;
      }
    }

    const [result] = await connection.query(
      `INSERT INTO generated_diagrams 
       (session_id, lesson_id, message_id, description, image_url, subject, success, error_message, revised_prompt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        lessonId,
        messageId,
        description,
        actualImageUrl, // Use processed URL
        subject,
        success,
        errorMessage,
        null,
      ]
    );

    console.log(
      `✅ Stored diagram in database with ID: ${result.insertId}, lesson_id: ${lessonId}`
    );
    return result.insertId;
  } catch (error) {
    console.error("❌ Error storing image in database:", error);
    throw error;
  } finally {
    // Only release if we created the connection
    if (shouldReleaseConnection && connection) {
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
  lessonId = null // Keep lessonId for cache check
) => {
  let localConnection = null;
  let shouldReleaseConnection = false;

  try {
    console.log("🔥 processLessonContent CALLED");
    console.log("📏 Content length:", content?.length);
    console.log("📜 Subject received:", subject);
    console.log("🎯 Lesson ID:", lessonId);

    // Get a fresh connection if none provided or if the provided one is closed
    if (!connection) {
      localConnection = await pool.getConnection();
      shouldReleaseConnection = true;
    } else {
      try {
        await connection.query("SELECT 1");
        localConnection = connection;
      } catch (connError) {
        console.warn("⚠️ Provided connection is closed, getting new one");
        localConnection = await pool.getConnection();
        shouldReleaseConnection = true;
      }
    }

    const inlinePattern = /\[CreateVisual:\s*["'](.+?)["']\]/g;
    const blockPattern = /CreateVisual:\s*([\s\S]+?)(?=\n\n|$)/gi;

    let processedContent = content;
    const allMatches = [];

    console.log("🔍 Starting visual processing...");
    console.log(`📝 Original subject: ${subject}`);

    // Inline matches
    for (const match of content.matchAll(inlinePattern)) {
      let description = match[1].trim().replace(/\s+/g, " ");
      allMatches.push({ fullMatch: match[0], description, subject });
      console.log(`✅ Found inline visual: "${description}"`);
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
        description = description.replace(/\s+/g, " ");
        const finalSubject = subjectOverride || subject;
        allMatches.push({
          fullMatch: match[0],
          description,
          subject: finalSubject,
        });
        console.log(
          `🧾 Parsed block visual: Subject="${finalSubject}", Description="${description}"`
        );
      }
    }

    console.log(`🧪 Total visuals to generate: ${allMatches.length}`);

    // Process visuals
    for (const {
      fullMatch,
      description,
      subject: effectiveSubject,
    } of allMatches) {
      console.log(
        `🎯 Handling diagram for: "${description}" [Subject: ${effectiveSubject}, Lesson: ${lessonId}]`
      );

      let diagramResult;
      let diagramId = null;

      // ✅ Only lessonId-based cache check
      if (localConnection && lessonId) {
        try {
          const [rows] = await connection.query(
            `SELECT id, image_url
           FROM generated_diagrams
           WHERE lesson_id = ? AND description = ? AND success = 1
           ORDER BY generation_time DESC LIMIT 1`,
            [lessonId, description]
          );

          if (rows.length > 0) {
            const existing = rows[0];
            console.log(
              `📂 Image found in lesson cache: Lesson=${lessonId}, ID=${existing.id}`
            );
            diagramResult = { success: true, imageUrl: existing.image_url };
            diagramId = existing.id;
          } else {
            console.log(
              `🔎 No existing image found for Lesson=${lessonId}, will generate new one.`
            );
          }
        } catch (cacheError) {
          console.warn("⚠️ Lesson cache check failed:", cacheError.message);
        }
      }

      // 🖼️ Generate if no existing image
      if (!diagramResult) {
        console.log(`⚙️ Generating new diagram for "${description}"`);
        diagramResult = await generateDiagram(description, effectiveSubject);

        if (diagramResult.success && sessionId && localConnection) {
          try {
            if (
              !diagramResult.imageUrl ||
              typeof diagramResult.imageUrl !== "string"
            ) {
              console.warn(
                "⚠️ Invalid imageUrl format:",
                typeof diagramResult.imageUrl
              );
              diagramResult.imageUrl = null;
            }

            diagramId = await storeImageInDatabase(
              sessionId,
              messageId || null,
              description,
              diagramResult.imageUrl,
              effectiveSubject,
              true,
              null,
              localConnection,
              lessonId
            );
            console.log(
              `💾 Stored new diagram in DB: ID=${diagramId}, Lesson=${lessonId}`
            );
          } catch (dbError) {
            console.warn("⚠️ DB Store Error:", dbError.message);
          }
        }
      }

      // Replace placeholder with diagram
      if (diagramResult?.success) {
        const imageHtml = `
        <div class="lesson-diagram" 
             style="margin: 20px 0; text-align: center; border: 2px solid #e0e0e0; border-radius: 12px; padding: 15px; background: #f9f9f9;" 
             data-diagram-id="${diagramId}" 
             data-lesson-id="${lessonId}"
             data-description="${description.replace(/"/g, "&quot;")}"
             data-subject="${effectiveSubject}">
          <h4 style="color: #333; margin-bottom: 10px; font-size: 16px;">${description}</h4>
          <img src="${diagramResult.imageUrl}" 
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
            } | 
            Labels: A, B, C, D, E, F, G, H, I, J (as applicable)
          </p>
        </div>`;

        processedContent = processedContent.replace(fullMatch, imageHtml);
        console.log(
          `✅ Inserted diagram for: ${description} (Lesson: ${lessonId})`
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
        console.log("🔌 Released local database connection");
      } catch (releaseError) {
        console.warn("⚠️ Error releasing connection:", releaseError.message);
      }
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
    await connection.query(`
      CREATE TABLE IF NOT EXISTS image_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        original_url VARCHAR(1000) NOT NULL,
        cached_url VARCHAR(1000),
        description TEXT,
        subject VARCHAR(50),
        file_size INT,
        mime_type VARCHAR(50),
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        access_count INT DEFAULT 0,
        is_valid BOOLEAN DEFAULT TRUE,
        UNIQUE KEY unique_original_url (original_url(255))
      ) ENGINE=InnoDB
    `);

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

// Enhanced startLesson function with better image handling
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

    // Get connection early and keep it throughout the function
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

    console.log("Starting lesson for:", {
      student_name,
      subject,
      lesson_topic,
      lesson_id,
    });

    // Normalize subject
    const normalizedSubject = subject.trim().toLowerCase();
    console.log(
      `Received subject: ${subject}, normalized: ${normalizedSubject}, lesson_id: ${lesson_id}`
    );

    // Use original subject directly to fetch prompt dynamically
    let systemPrompt;
    try {
      const promptType = type?.trim() || "lesson";
      systemPrompt = await fetchPromptFromAPI(subject.trim(), promptType);
      console.log("Successfully fetched prompt from API for type:", promptType);
    } catch (error) {
      console.error("Error fetching prompt from API:", error);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch prompt for subject: ${subject} and type: ${type}`,
      });
    }

    // Helper: convert JS Date or ISO string to MySQL DATETIME
    const toMySQLDateTime = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 19).replace("T", " ");
    };

    // Check database columns availability
    const columnCheck = await checkDatabaseColumns(connection);

    // Check if session exists
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
      console.log(`Using existing session ID: ${sessionId}`);

      // Only insert the latest message for existing sessions if it has valid content
      if (messages.length > 0) {
        const latestMessage = messages[messages.length - 1];
        if (latestMessage.content && latestMessage.content.trim().length > 0) {
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
          console.log(`Inserted 1 new message for session ${sessionId}`);
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
      console.log(`Created new session with ID: ${sessionId}`);

      // Insert all initial messages for new session with valid content
      if (messages.length > 0) {
        const messageValues = messages
          .filter((msg) => msg.content && msg.content.trim().length > 0)
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
          console.log(`Inserted ${messageValues.length} initial messages`);
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

    // Filter out any messages with empty/null content
    const validMessages = messages.filter(
      (msg) => msg.content !== undefined && msg.content !== null
    );

    const chatHistory = [
      { role: "system", content: systemPrompt },
      ...validMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        role: "user",
        content: JSON.stringify({
          ...userLessonInput,
          student_response: messages[messages.length - 1]?.content || "",
        }),
      },
    ];

    const payload = {
      model: "gpt-4.1",
      messages: chatHistory,
      temperature: 1,
      max_tokens: 4096,
    };

    console.log("Sending request to OpenAI...");
    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let assistantContent = openaiResponse.data.choices?.[0]?.message?.content;
    let processedContent = assistantContent;
    let hasVisuals = false;

    // Generate message ID for this response
    const messageId = Date.now().toString();

    // Check if the response contains visual requests and process them
    if (
      assistantContent &&
      (assistantContent.includes("[CreateVisual:") ||
        assistantContent.includes("CreateVisual:"))
    ) {
      console.log("Processing visual content...");
      hasVisuals = true;

      // UPDATED: Pass lesson_id to processLessonContent
      processedContent = await processLessonContent(
        assistantContent,
        normalizedSubject,
        sessionId,
        messageId,
        connection,
        lesson_id
      );
    }

    // Store the assistant's response if it has valid content
    if (assistantContent) {
      const assistantMessage = {
        role: "assistant",
        content: assistantContent,
        processed_content: processedContent,
        has_visuals: hasVisuals,
        timestamp: toMySQLDateTime(new Date()),
        id: messageId,
      };

      // Build insert query dynamically based on available columns
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

      insertQuery += `) VALUES (?, ?, ?, ?, ?, ?`;
      if (columnCheck.hasProcessedContent) insertQuery += `, ?`;
      if (columnCheck.hasVisuals) insertQuery += `, ?`;
      insertQuery += `)`;

      await connection.query(insertQuery, insertValues);
    }

    // Return the processed content to the frontend
    const responseData = {
      ...openaiResponse.data,
      choices: [
        {
          ...openaiResponse.data.choices[0],
          message: {
            ...openaiResponse.data.choices[0].message,
            content: processedContent,
          },
        },
      ],
    };

    res.json({
      success: true,
      data: responseData,
      sessionId: sessionId,
      hasVisuals: hasVisuals,
      lesson_id: lesson_id,
    });
  } catch (error) {
    console.error("Lesson Error:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error?.message ||
        error.message ||
        "Internal Server Error",
    });
  } finally {
    // Always release the connection in the finally block
    if (connection) {
      connection.release();
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

// Add endpoint to generate individual diagrams (for testing)
const generateDiagramEndpoint = async (req, res) => {
  try {
    const { description, subject = "biology" } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: "Description is required",
      });
    }

    const result = await generateDiagram(description, subject);
    res.json(result);
  } catch (error) {
    console.error("Generate Diagram Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
};

module.exports = {
  startLesson,
  getLessonHistory,
  saveLessonData,
  generateDiagramEndpoint,
  generateDiagram,
};
