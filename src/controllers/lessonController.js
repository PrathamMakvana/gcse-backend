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
  connectionLimit: 10,
  queueLimit: 0,
});

// API endpoint for fetching prompts
const PROMPT_API_URL = "https://thinkdream.in/GCSE/api/get-prompt/";

// Function to fetch prompt from API
const fetchPromptFromAPI = async (subject) => {
  try {
    const encodedSubject = encodeURIComponent(subject);
    const response = await axios.get(`${PROMPT_API_URL}${encodedSubject}`);

    if (response.data.success && response.data.data?.prompt) {
      return response.data.data.prompt;
    }
    throw new Error(`No prompt found for subject: ${subject}`);
  } catch (error) {
    console.error(`Error fetching prompt for ${subject}:`, error.message);
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
`
    };

    const enhancedPrompt = subjectPrompts[subject.toLowerCase()] || subjectPrompts.default;

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
        timeout: 45000, // Increased timeout for HD generation
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
const storeImageInDatabase = async (sessionId, messageId, description, imageUrl, subject, success, errorMessage = null) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    const [result] = await connection.query(
      `INSERT INTO generated_diagrams 
       (session_id, message_id, description, image_url, subject, success, error_message, revised_prompt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, messageId, description, imageUrl, subject, success, errorMessage, null]
    );
    
    console.log(`Stored diagram in database with ID: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    console.error("Error storing image in database:", error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Function to retrieve stored images from database
const getStoredImages = async (sessionId) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    const [images] = await connection.query(
      `SELECT * FROM generated_diagrams WHERE session_id = ? ORDER BY generation_time DESC`,
      [sessionId]
    );
    
    return images;
  } catch (error) {
    console.error("Error retrieving stored images:", error);
    return [];
  } finally {
    if (connection) connection.release();
  }
};

// Enhanced function to process lesson content with better image handling
const processLessonContent = async (content, subject, sessionId = null, messageId = null) => {
  try {
    // Regex to find [CreateVisual: "description"] patterns
    const visualPattern = /\[CreateVisual:\s*["']([^"']+)["']\]/g;
    let processedContent = content;
    const matches = [...content.matchAll(visualPattern)];

    console.log(`Found ${matches.length} visual requests in lesson content`);

    // Process each visual request
    for (const match of matches) {
      const fullMatch = match[0];
      const description = match[1];

      console.log(`Generating diagram for: ${description}`);

      // Generate the diagram
      const diagramResult = await generateDiagram(description, subject);

      if (diagramResult.success) {
        // Store the image in database for persistence
        let diagramId = null;
        if (sessionId && messageId) {
          try {
            diagramId = await storeImageInDatabase(
              sessionId, 
              messageId, 
              description, 
              diagramResult.imageUrl, 
              subject, 
              true
            );
          } catch (dbError) {
            console.warn("Failed to store image in database:", dbError);
          }
        }

        // Create enhanced HTML with better styling and data attributes
        const imageHtml = `
        <div class="lesson-diagram" 
             style="margin: 20px 0; text-align: center; border: 2px solid #e0e0e0; border-radius: 12px; padding: 15px; background: #f9f9f9;" 
             data-diagram-id="${diagramId}" 
             data-description="${description.replace(/"/g, '&quot;')}"
             data-subject="${subject}">
          <h4 style="color: #333; margin-bottom: 10px; font-size: 16px;">${description}</h4>
          <img src="${diagramResult.imageUrl}" 
               alt="Educational diagram: ${description}" 
               style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <div style="display: none; padding: 20px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24;">
            <p style="margin: 0; font-weight: bold;">📊 Diagram: ${description}</p>
            <p style="margin: 5px 0 0 0; font-size: 12px;">*Image could not be loaded*</p>
          </div>
          <p style="font-style: italic; color: #666; margin-top: 10px; font-size: 12px;">
            Subject: ${subject.charAt(0).toUpperCase() + subject.slice(1)} | 
            Labels: A, B, C, D, E, F, G, H, I, J (as applicable)
          </p>
        </div>`;

        processedContent = processedContent.replace(fullMatch, imageHtml);
        console.log(`Successfully generated and stored diagram for: ${description}`);
      } else {
        // Store failed attempt in database
        if (sessionId && messageId) {
          try {
            await storeImageInDatabase(
              sessionId, 
              messageId, 
              description, 
              null, 
              subject, 
              false, 
              diagramResult.error
            );
          } catch (dbError) {
            console.warn("Failed to store failed image attempt in database:", dbError);
          }
        }

        // Enhanced fallback with better styling
        const fallbackHtml = `
        <div class="lesson-diagram-fallback" 
             style="margin: 20px 0; padding: 20px; background: #fff3cd; border: 2px solid #ffeaa7; border-radius: 12px; border-left: 6px solid #f39c12;"
             data-description="${description.replace(/"/g, '&quot;')}"
             data-subject="${subject}">
          <h4 style="margin: 0 0 10px 0; color: #856404; font-size: 16px;">📊 ${description}</h4>
          <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #ffeaa7;">
            <p style="margin: 0; font-weight: bold; color: #856404;">Key Points to Visualize:</p>
            <ul style="margin: 10px 0; padding-left: 20px; color: #856404;">
              <li>Look for labeled parts A, B, C, D, E, F, G, H, I, J</li>
              <li>Focus on the structural relationships</li>
              <li>Note the biological/scientific processes shown</li>
            </ul>
          </div>
          <p style="margin: 10px 0 0 0; font-size: 11px; color: #856404;">
            *Diagram generation temporarily unavailable - Error: ${diagramResult.error}*
          </p>
        </div>`;

        processedContent = processedContent.replace(fullMatch, fallbackHtml);
        console.log(`Fallback used for: ${description} - ${diagramResult.error}`);
      }
    }

    return processedContent;
  } catch (error) {
    console.error("Error processing lesson content:", error);
    return content; // Return original content if processing fails
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
        student_summary TEXT,
        subject VARCHAR(50) NOT NULL,
        exam_board VARCHAR(50),
        tier VARCHAR(20),
        lesson_topic_code VARCHAR(50),
        lesson_topic VARCHAR(100),
        lesson_status VARCHAR(20),
        lesson_start_time DATETIME,
        lesson_end_time DATETIME,
        lesson_duration_minutes INT,
        student_start_time DATETIME,
        student_end_time DATETIME,
        student_total_duration_minutes INT,
        designed_pacing_minutes INT,
        lesson_quality_score INT,
        student_engagement_score INT,
        knowledge_gain_estimate INT,
        quiz_score INT,
        quiz_question_topics JSON,
        regeneration_count INT,
        regeneration_maxed BOOLEAN,
        lesson_quality_commentary TEXT,
        student_confidence_level VARCHAR(20),
        student_progress_trend VARCHAR(20),
        diagrams_generated INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES tutoring_sessions(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
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
    } = req.body;

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
    console.log(
      `Received subject: ${subject}, normalized: ${normalizedSubject}`
    );

    // Handle different subject name variations
    let apiSubjectName;
    switch (normalizedSubject) {
      case "maths":
      case "mathematics":
        apiSubjectName = "Mathematics";
        break;
      case "english language":
        apiSubjectName = "English Language";
        break;
      case "english literature":
        apiSubjectName = "English Literature";
        break;
      case "biology":
        apiSubjectName = "Biology";
        break;
      case "combined science":
        apiSubjectName = "Combined Science";
        break;
      default:
        return res.status(400).json({
          success: false,
          error: `Unsupported subject: ${subject}`,
        });
    }

    // Verify exam board is supported for this subject
    const examBoards = {
      Mathematics: ["Edexcel"],
      "English Language": ["AQA"],
      Biology: ["AQA"],
      "Combined Science": ["AQA"],
      "English Literature": ["AQA", "Edexcel", "OCR"],
    };

    if (!examBoards[apiSubjectName].includes(exam_board.trim())) {
      return res.status(400).json({
        success: false,
        error: `Exam board ${exam_board} not supported for ${subject}`,
      });
    }

    // Get the appropriate prompt from API
    let systemPrompt;
    try {
      systemPrompt = await fetchPromptFromAPI(apiSubjectName);
      console.log("Successfully fetched prompt from API");
    } catch (error) {
      console.error("Error fetching prompt from API:", error);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch prompt for subject: ${subject}`,
      });
    }

    // Get database connection
    connection = await pool.getConnection();

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
             (session_id, role, content, timestamp, message_id) 
             VALUES (?, ?, ?, ?, ?)`,
            [
              sessionId,
              latestMessage.role,
              latestMessage.content.trim(),
              latestMessage.timestamp || new Date().toISOString(),
              latestMessage.id || null,
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
          ]);

        if (messageValues.length > 0) {
          await connection.query(
            `INSERT INTO session_messages 
             (session_id, role, content, timestamp, message_id) 
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
      simulate_student_responses: false,
      lesson_start_time: new Date().toISOString(),
    };

    // Filter out any messages with empty/null content
    const validMessages = messages.filter(
      (msg) => msg.content && msg.content.trim().length > 0
    );

    const chatHistory = [
      { role: "system", content: systemPrompt },
      ...validMessages,
      { role: "user", content: JSON.stringify(userLessonInput) },
    ];

    const payload = {
      model: "gpt-4o",
      messages: chatHistory,
      temperature: 0.7,
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
      processedContent = await processLessonContent(
        assistantContent,
        normalizedSubject,
        sessionId,
        messageId
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
      let insertQuery = `INSERT INTO session_messages (session_id, role, content, timestamp, message_id`;
      let insertValues = [
        sessionId,
        assistantMessage.role,
        assistantMessage.content,
        assistantMessage.timestamp,
        assistantMessage.id,
      ];

      if (columnCheck.hasProcessedContent) {
        insertQuery += `, processed_content`;
        insertValues.push(assistantMessage.processed_content);
      }

      if (columnCheck.hasVisuals) {
        insertQuery += `, has_visuals`;
        insertValues.push(assistantMessage.has_visuals);
      }

      insertQuery += `) VALUES (?, ?, ?, ?, ?`;
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
            content: processedContent, // Send processed content with actual images
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
    if (connection) connection.release();
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
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    connection = await pool.getConnection();

    // Check if lesson_data table exists and get its columns
    const [tableExists] = await connection.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'lesson_data'
    `);

    if (tableExists[0].count === 0) {
      // Create the table if it doesn't exist
      await connection.query(`
        CREATE TABLE lesson_data (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id INT,
          student_id VARCHAR(100) NOT NULL,
          student_name VARCHAR(100) NOT NULL,
          student_summary TEXT,
          subject VARCHAR(50) NOT NULL,
          exam_board VARCHAR(50),
          tier VARCHAR(20),
          lesson_topic_code VARCHAR(50),
          lesson_topic VARCHAR(100),
          lesson_status VARCHAR(20),
          lesson_start_time DATETIME,
          lesson_end_time DATETIME,
          lesson_duration_minutes INT,
          student_start_time DATETIME,
          student_end_time DATETIME,
          student_total_duration_minutes INT,
          designed_pacing_minutes INT,
          lesson_quality_score INT,
          student_engagement_score INT,
          knowledge_gain_estimate INT,
          quiz_score INT,
          quiz_question_topics JSON,
          regeneration_count INT,
          regeneration_maxed BOOLEAN,
          lesson_quality_commentary TEXT,
          student_confidence_level VARCHAR(20),
          student_progress_trend VARCHAR(20),
          diagrams_generated INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES tutoring_sessions(id) ON DELETE SET NULL
        ) ENGINE=InnoDB
      `);
      console.log("✅ Created lesson_data table");
    } else {
      // Check if diagrams_generated column exists
      const [columns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'lesson_data' 
        AND COLUMN_NAME = 'diagrams_generated'
      `);

      if (columns.length === 0) {
        // Add the missing column
        await connection.query(`
          ALTER TABLE lesson_data 
          ADD COLUMN diagrams_generated INT DEFAULT 0
        `);
        console.log("✅ Added diagrams_generated column to lesson_data table");
      }
    }

    // Extract all fields except full_chat_transcript
    const {
      full_chat_transcript, // This will be excluded
      quiz_question_topics,
      ...dataToSave
    } = lessonData;

    // Convert array fields to JSON strings if needed
    const quizTopicsJson = quiz_question_topics
      ? JSON.stringify(quiz_question_topics)
      : null;

    // Count how many diagrams were generated for this session
    let diagramCount = 0;
    if (dataToSave.session_id) {
      try {
        const [diagramResult] = await connection.query(
          `SELECT COUNT(*) as count FROM generated_diagrams WHERE session_id = ? AND success = 1`,
          [dataToSave.session_id]
        );
        diagramCount = diagramResult[0].count;
      } catch (diagramError) {
        console.warn("Could not count diagrams, setting to 0:", diagramError.message);
        diagramCount = 0;
      }
    }

    // Insert the lesson data
    const [result] = await connection.query(
      `INSERT INTO lesson_data (
        session_id, student_id, student_name, student_summary,
        subject, exam_board, tier, lesson_topic_code, lesson_topic,
        lesson_status, lesson_start_time, lesson_end_time,
        lesson_duration_minutes, student_start_time, student_end_time,
        student_total_duration_minutes, designed_pacing_minutes,
        lesson_quality_score, student_engagement_score, knowledge_gain_estimate,
        quiz_score, quiz_question_topics, regeneration_count,
        regeneration_maxed, lesson_quality_commentary,
        student_confidence_level, student_progress_trend, diagrams_generated
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?
      )`,
      [
        dataToSave.session_id || null,
        dataToSave.student_id,
        dataToSave.student_name,
        dataToSave.student_summary,
        dataToSave.subject,
        dataToSave.exam_board,
        dataToSave.tier,
        dataToSave.lesson_topic_code,
        dataToSave.lesson_topic,
        dataToSave.lesson_status,
        dataToSave.lesson_start_time,
        dataToSave.lesson_end_time,
        dataToSave.lesson_duration_minutes,
        dataToSave.student_start_time,
        dataToSave.student_end_time,
        dataToSave.student_total_duration_minutes,
        dataToSave.designed_pacing_minutes,
        dataToSave.lesson_quality_score,
        dataToSave.student_engagement_score,
        dataToSave.knowledge_gain_estimate,
        dataToSave.quiz_score,
        quizTopicsJson,
        dataToSave.regeneration_count,
        dataToSave.regeneration_maxed,
        dataToSave.lesson_quality_commentary,
        dataToSave.student_confidence_level,
        dataToSave.student_progress_trend,
        diagramCount,
      ]
    );

    res.json({
      success: true,
      data: {
        id: result.insertId,
        diagrams_generated: diagramCount,
      },
    });
  } catch (error) {
    console.error("Error saving lesson data:", error);
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
