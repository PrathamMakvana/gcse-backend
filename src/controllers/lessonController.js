const axios = require("axios");
const mysql = require("mysql2/promise");

// Create database connection pool
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


const PROMPT_API_URL = "https://thinkdream.in/GCSE/api/get-prompt/";

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

// Enhanced DALL-E Image Generation Function with better labeling
const generateDiagram = async (description, subject = "biology") => {
  try {
    // Enhanced prompts with specific labeling instructions
    const subjectPrompts = {
      biology: `
Create a high-quality, educational biology diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels
- Place labels OUTSIDE the diagram with clear arrows pointing to structures
- Use sequential labels: A, B, C, D, E, F, G, H, I, J (in that order)
- Each label must be at least 16px font size and highly visible
- Labels should be positioned to avoid overlapping
- Use straight, thick black arrows from labels to structures
- White background with high contrast
- Professional scientific illustration style
- All biological terminology must be spelled correctly
- Include a title at the top of the diagram

Example labeling format:
A → [Structure name]
B → [Structure name]
C → [Structure name]

Make sure every major structure has a clear, readable label with proper arrows.
`,
      chemistry: `
Create a clear, educational chemistry diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels OUTSIDE the diagram with clear arrows
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show molecular structures, bonds, and reactions clearly
- White background with high contrast
- Professional scientific illustration style
- Include proper chemical symbols and formulas
- Title at the top of the diagram
`,
      physics: `
Create a clear, educational physics diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels OUTSIDE the diagram with clear arrows
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show measurements, forces, and physical principles clearly
- White background with high contrast
- Professional scientific illustration style
- Include proper units and symbols
- Title at the top of the diagram
`,
      mathematics: `
Create a clear, educational mathematics diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels OUTSIDE the diagram with clear arrows
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show geometric shapes, coordinate systems clearly
- White background with high contrast
- Professional mathematical illustration style
- Include proper mathematical notation
- Title at the top of the diagram
`,
      maths: `
Create a clear, educational mathematics diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels OUTSIDE the diagram with clear arrows
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show geometric shapes, coordinate systems clearly
- White background with high contrast
- Professional mathematical illustration style
- Include proper mathematical notation
- Title at the top of the diagram
`,
      "english language": `
Create a clear, structured diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels clearly with connecting lines
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show language structures and relationships
- White background with high contrast
- Professional educational illustration style
- Title at the top of the diagram
`,
      "english literature": `
Create a clear, structured diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels clearly with connecting lines
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show literary relationships and themes
- White background with high contrast
- Professional educational illustration style
- Title at the top of the diagram
`,
      "combined science": `
Create a clear, educational combined science diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels OUTSIDE the diagram with clear arrows
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- Show scientific concepts clearly
- White background with high contrast
- Professional scientific illustration style
- Include proper scientific terminology
- Title at the top of the diagram
`,
      default: `
Create a clear educational diagram of "${description}". 
CRITICAL REQUIREMENTS:
- Use LARGE, BOLD, BLACK text for all labels (minimum 16px)
- Place labels OUTSIDE the diagram with clear arrows
- Use sequential labels: A, B, C, D, E, F, G, H, I, J
- White background with high contrast
- Professional educational illustration style
- Title at the top of the diagram
`,
    };

    const enhancedPrompt =
      subjectPrompts[subject.toLowerCase()] || subjectPrompts.default;

    const response = await axios.post(
      "https://api.openai.com/v1/images/generations",
      {
        model: "dall-e-3",
        prompt: enhancedPrompt,
        n: 1,
        size: "1024x1024",
        quality: "hd", // Changed to HD for better quality
        style: "natural",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 300000, // 5 minutes
      }
    );

    if (response.data?.data?.[0]?.url) {
      return {
        success: true,
        imageUrl: response.data.data[0].url,
        revisedPrompt: response.data.data[0].revised_prompt,
        originalDescription: description,
      };
    } else {
      throw new Error("No image URL returned from DALL-E");
    }
  } catch (error) {
    console.error("DALL-E Error:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      originalDescription: description,
    };
  }
};

// Function to store image in database for persistent storage
const storeImageInDatabase = async (
  sessionId,
  messageId,
  description,
  imageUrl,
  subject,
  success,
  errorMessage = null,
  connection = null // Accept connection parameter
) => {
  let shouldReleaseConnection = false;
  
  try {
    // Use provided connection or get new one
    if (!connection) {
      connection = await pool.getConnection();
      shouldReleaseConnection = true;
    }

    const [result] = await connection.query(
      `INSERT INTO generated_diagrams 
       (session_id, message_id, description, image_url, subject, success, error_message, revised_prompt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        messageId,
        description,
        imageUrl,
        subject,
        success,
        errorMessage,
        null,
      ]
    );

    console.log(`Stored diagram in database with ID: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    console.error("Error storing image in database:", error);
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
  connection = null
) => {
  try {
    const inlinePattern = /\[CreateVisual:\s*["'](.+?)["']\]/g;
    const blockPattern = /CreateVisual:\s*([^]+)/gi;

    let processedContent = content;
    const allMatches = [];

    // 1. Match inline prompts like [CreateVisual: "Draw a plant cell"]
    for (const match of content.matchAll(inlinePattern)) {
      allMatches.push({
        fullMatch: match[0],
        description: match[1].trim(),
      });
    }

    // 2. Match block prompts (multiline)
    for (const match of content.matchAll(blockPattern)) {
      const block = match[0].trim();
      const focusMatch = block.match(/Focus:\s*(.+)/i);
      const description = focusMatch ? focusMatch[1].trim() : null;

      if (description) {
        allMatches.push({
          fullMatch: block,
          description,
        });
      }
    }

    console.log(`🧪 Found ${allMatches.length} visual requests in lesson content`);

    // 3. Process each visual request
    for (const { fullMatch, description } of allMatches) {
      console.log(`🎯 Generating diagram for: ${description}`);

      const diagramResult = await generateDiagram(description, subject);

      if (diagramResult.success) {
        let diagramId = null;
        if (sessionId && messageId) {
          try {
            diagramId = await storeImageInDatabase(
              sessionId,
              messageId,
              description,
              diagramResult.imageUrl,
              subject,
              true,
              null,
              connection
            );
          } catch (dbError) {
            console.warn("⚠ DB Store Error:", dbError);
          }
        }

        const imageHtml = `
        <div class="lesson-diagram" 
             style="margin: 20px 0; text-align: center; border: 2px solid #e0e0e0; border-radius: 12px; padding: 15px; background: #f9f9f9;" 
             data-diagram-id="${diagramId}" 
             data-description="${description.replace(/"/g, "&quot;")}"
             data-subject="${subject}">
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
            Subject: ${subject.charAt(0).toUpperCase() + subject.slice(1)} | 
            Labels: A, B, C, D, E, F, G, H, I, J (as applicable)
          </p>
        </div>`;

        processedContent = processedContent.replace(fullMatch, imageHtml);
        console.log(`✅ Inserted diagram for: ${description}`);
      } else {
        // Error fallback
        if (sessionId && messageId) {
          try {
            await storeImageInDatabaseFixed(
              sessionId,
              messageId,
              description,
              null,
              subject,
              false,
              diagramResult.error,
              connection
            );
          } catch (dbError) {
            console.warn("⚠ Fallback store error:", dbError);
          }
        }

        const fallbackHtml = `
        <div class="lesson-diagram-fallback" 
             style="margin: 20px 0; padding: 20px; background: #fff3cd; border: 2px solid #ffeaa7; border-radius: 12px; border-left: 6px solid #f39c12;"
             data-description="${description.replace(/"/g, "&quot;")}"
             data-subject="${subject}">
          <h4 style="margin: 0 0 10px 0; color: #856404; font-size: 16px;">📊 ${description}</h4>
          <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #ffeaa7;">
            <p style="margin: 0; font-weight: bold; color: #856404;">Key Points to Visualize:</p>
            <ul style="margin: 10px 0; padding-left: 20px; color: #856404;">
              <li>Look for labeled parts A–J</li>
              <li>Focus on structure and relationships</li>
              <li>Include visual aids like arrows/labels</li>
            </ul>
          </div>
          <p style="margin: 10px 0 0 0; font-size: 11px; color: #856404;">
            Diagram generation failed - Error: ${diagramResult.error}
          </p>
        </div>`;

        processedContent = processedContent.replace(fullMatch, fallbackHtml);
        console.log(`⚠ Fallback used for: ${description}`);
      }
    }

    return processedContent;
  } catch (error) {
    console.error("🚨 Visual processing error:", error);
    return content;
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
        INDEX idx_expires_at (expires_at),
        INDEX idx_generation_time (generation_time)
      ) ENGINE=InnoDB
    `);

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
      type
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
    });

 // Normalize subject
const normalizedSubject = subject.trim().toLowerCase();
console.log(`Received subject: ${subject}, normalized: ${normalizedSubject}`);

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
              latestMessage.timestamp || new Date().toISOString(),
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
          new Date().toISOString(),
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
            msg.timestamp || new Date().toISOString(),
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
      lesson_start_time: new Date().toISOString(),
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
    if (assistantContent && assistantContent.includes("[CreateVisual:")) {
      console.log("Processing visual content...");
      hasVisuals = true;
      
      // CRITICAL FIX: Pass connection to processLessonContent or use pool
      // Option 1: Modify processLessonContent to accept connection parameter
      processedContent = await processLessonContent(
        assistantContent,
        normalizedSubject,
        sessionId,
        messageId,
        connection // Pass the existing connection
      );
    }

    // Store the assistant's response if it has valid content
    if (assistantContent) {
      const assistantMessage = {
        role: "assistant",
        content: assistantContent,
        processed_content: processedContent,
        has_visuals: hasVisuals,
        timestamp: new Date().toISOString(),
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
    });

  } catch (error) {
    console.error("Lesson Error:", error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error?.response?.data?.error?.message || "Internal Server Error",
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
      lesson_start_time: lessonData.lesson_start_time || null,
      lesson_end_time: lessonData.lesson_end_time || null,
      lesson_duration_minutes: lessonData.lesson_duration_minutes || null,
      student_start_time: lessonData.student_start_time || null,
      student_end_time: lessonData.student_end_time || null,
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
      student_confidence_level: lessonData.student_confidence_level || null,
      student_progress_trend: lessonData.student_progress_trend || null,
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
