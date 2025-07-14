const axios = require("axios");
const mysql = require("mysql2/promise");
const prompts = require('./prompt.js');

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

// DALL-E Image Generation Function
const generateDiagram = async (description, subject = "biology") => {
  try {
    // Enhanced prompts for better educational diagrams
const subjectPrompts = {
 biology: `Create a high-quality, educational biology diagram of ${description}. 
Use a clean, professional scientific illustration style with:
- Accurate anatomical structures
- Clear, properly spelled English labels for each part
- Straight, neat arrows pointing from each label to the correct part
- High contrast for visibility
- A white background for textbook-style clarity

Ensure that:
- All major biological parts are labeled
- Labels do not overlap and are easy to read
- Label text uses consistent font and size
- Use standard biological terminology appropriate to the topic

`,
  
  chemistry: `Create a clear, educational diagram of ${description}. Style: clean scientific illustration with visible molecular structures, chemical bonds, and clear, accurate labels in English. Use arrows or callouts where needed. White background, high-quality for textbook use.`,

  physics: `Create a clear, educational diagram of ${description}. Style: precise technical illustration with clearly visible measurement indicators and labels in correct English. Use proper symbols and units. All elements should be well-spaced and readable. White background, textbook-quality.`,

  mathematics: `Create a clean educational diagram of ${description}. Use accurate geometric shapes, coordinate systems, and mathematical notations. Labels should be in correct and readable English. Ensure all labels, arrows, and markings are clear and high contrast. White background, textbook quality.`,

  maths: `Create a clean educational diagram of ${description}. Use accurate geometric shapes, coordinate systems, and mathematical notations. Labels should be in correct and readable English. Ensure all labels, arrows, and markings are clear and high contrast. White background, textbook quality.`,

  "english language": `Create a clear, structured diagram of ${description}. Style: language analysis diagram with visible text boxes and arrows showing relationships. Use correct English for all labels and explanations. Layout should be organized and readable. White background, textbook quality.`,

  "english literature": `Create a clear, structured diagram of ${description}. Style: literary analysis diagram with organized layout showing relationships between themes, characters, and ideas. All labels should be in proper English and clearly visible. Use arrows or connectors where necessary. White background, textbook quality.`,

  "combined science": `Create a clear, educational diagram of ${description}. Combine biology, chemistry, and physics concepts using clean, labeled visuals. All labels should be written in correct English and be clearly visible. Use arrows and callouts as needed. White background, professional textbook quality.`,

  default: `Create a clear educational diagram of ${description}. Style: clean, well-organized illustration with clear, readable English labels. Ensure visual clarity with arrows, spacing, and contrast. White background, suitable for professional educational materials.`
};


    const enhancedPrompt = subjectPrompts[subject.toLowerCase()] || subjectPrompts.default;

    const response = await axios.post(
      "https://api.openai.com/v1/images/generations",
      {
        model: "dall-e-3",
        prompt: enhancedPrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        style: "natural"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000 // 30 second timeout
      }
    );

    if (response.data?.data?.[0]?.url) {
      return {
        success: true,
        imageUrl: response.data.data[0].url,
        revisedPrompt: response.data.data[0].revised_prompt
      };
    } else {
      throw new Error("No image URL returned from DALL-E");
    }
  } catch (error) {
    console.error("DALL-E Error:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
};

// Enhanced function to process lesson content and generate diagrams
const processLessonContent = async (content, subject) => {
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
        // Replace the text with an actual image
        const imageHtml = `
        <div class="lesson-diagram" style="margin: 20px 0; text-align: center;">
          <img src="${diagramResult.imageUrl}" alt="${description}" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <p style="font-style: italic; color: #666; margin-top: 10px; font-size: 14px;">Figure: ${description}</p>
        </div>`;
        
        processedContent = processedContent.replace(fullMatch, imageHtml);
        console.log(`Successfully generated diagram for: ${description}`);
      } else {
        // Fallback to text if image generation fails
        const fallbackHtml = `
        <div class="lesson-diagram-fallback" style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-left: 4px solid #007bff; border-radius: 4px;">
          <p style="margin: 0; font-weight: bold; color: #007bff;">📊 Visual: ${description}</p>
          <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">*Diagram generation temporarily unavailable*</p>
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
    
    const columnNames = columns.map(col => col.COLUMN_NAME);
    
    return {
      hasProcessedContent: columnNames.includes('processed_content'),
      hasVisuals: columnNames.includes('has_visuals')
    };
  } catch (error) {
    console.error("Error checking database columns:", error);
    return { hasProcessedContent: false, hasVisuals: false };
  }
};

// Initialize database tables
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

    // 4. Create generated_diagrams table to track DALL-E usage
    await connection.query(`
      CREATE TABLE IF NOT EXISTS generated_diagrams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        message_id VARCHAR(100),
        description TEXT NOT NULL,
        image_url VARCHAR(500),
        revised_prompt TEXT,
        subject VARCHAR(50),
        generation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        INDEX idx_session_id (session_id)
      ) ENGINE=InnoDB
    `);

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

    console.log("Starting lesson for:", { student_name, subject, lesson_topic });

    // Normalize subject
    const normalizedSubject = subject.trim().toLowerCase();
    console.log(`Received subject: ${subject}, normalized: ${normalizedSubject}`);

    let subjectKey;

    // Handle different subject name variations
    if (normalizedSubject === "maths" || normalizedSubject === "mathematics") {
      subjectKey = "MATHS_PROMPT";
    } else if (normalizedSubject === "english language") {
      subjectKey = "ENGLISH_LANGUAGE_PROMPT";
    } else if (normalizedSubject === "english literature") {
      subjectKey = "ENGLISH_LITERATURE_PROMPT";
    } else if (normalizedSubject === "biology") {
      subjectKey = "BIOLOGY_PROMPT";
    } else if (normalizedSubject === "combined science") {
      subjectKey = "COMBINED_SCIENCE_PROMPT";
    } else {
      return res.status(400).json({ 
        success: false, 
        error: `Unsupported subject: ${subject}` 
      });
    }

    // Verify exam board is supported for this subject
    const examBoards = {
      "MATHS_PROMPT": ["Edexcel"],
      "ENGLISH_LANGUAGE_PROMPT": ["AQA"],
      "BIOLOGY_PROMPT": ["AQA"],  
      "COMBINED_SCIENCE_PROMPT": ["AQA"],
      "ENGLISH_LITERATURE_PROMPT": ["AQA", "Edexcel", "OCR"]
    };

    if (!examBoards[subjectKey].includes(exam_board.trim())) {
      return res.status(400).json({
        success: false,
        error: `Exam board ${exam_board} not supported for ${subject}`
      });
    }

    // Get the appropriate prompt
    const systemPrompt = prompts[subjectKey];
    if (!systemPrompt) {
      return res.status(400).json({
        success: false,
        error: `No prompt found for subject: ${subject}`
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
          .filter(msg => msg.content && msg.content.trim().length > 0)
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
      msg => msg.content && msg.content.trim().length > 0
    );

    const chatHistory = [
      { role: "system", content: systemPrompt },
      ...validMessages,
      { role: "user", content: JSON.stringify(userLessonInput) },
    ];

    const payload = {
      model: "gpt-4.1",
      messages: chatHistory,
      temperature:1,
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

    // Check if the response contains visual requests and process them
    if (assistantContent && assistantContent.includes('[CreateVisual:')) {
      console.log("Processing visual content...");
      hasVisuals = true;
      processedContent = await processLessonContent(assistantContent, normalizedSubject);
    }

    // Store the assistant's response if it has valid content
    if (assistantContent) {
      const assistantMessage = {
        role: "assistant",
        content: assistantContent,
        processed_content: processedContent,
        has_visuals: hasVisuals,
        timestamp: new Date().toISOString(),
        id: Date.now().toString(),
      };

      // Build insert query dynamically based on available columns
      let insertQuery = `INSERT INTO session_messages (session_id, role, content, timestamp, message_id`;
      let insertValues = [sessionId, assistantMessage.role, assistantMessage.content, assistantMessage.timestamp, assistantMessage.id];
      
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
      choices: [{
        ...openaiResponse.data.choices[0],
        message: {
          ...openaiResponse.data.choices[0].message,
          content: processedContent // Send processed content with actual images
        }
      }]
    };

    res.json({
      success: true,
      data: responseData,
      sessionId: sessionId,
      hasVisuals: hasVisuals
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
    if (!lessonData.student_id || !lessonData.student_name || !lessonData.subject) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }

    connection = await pool.getConnection();

    // Create lesson_data table with all necessary columns
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

    // Extract all fields except full_chat_transcript
    const {
      full_chat_transcript, // This will be excluded
      quiz_question_topics,
      ...dataToSave
    } = lessonData;

    // Convert array fields to JSON strings if needed
    const quizTopicsJson = quiz_question_topics ? 
      JSON.stringify(quiz_question_topics) : null;

    // Count how many diagrams were generated for this session
    const [diagramCount] = await connection.query(
      `SELECT COUNT(*) as count FROM generated_diagrams WHERE session_id = ? AND success = 1`,
      [dataToSave.session_id]
    );

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
        diagramCount[0].count
      ]
    );

    res.json({ 
      success: true, 
      data: { 
        id: result.insertId,
        diagrams_generated: diagramCount[0].count
      } 
    });
  } catch (error) {
    console.error("Error saving lesson data:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Internal Server Error" 
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
        error: "Description is required" 
      });
    }

    const result = await generateDiagram(description, subject);
    res.json(result);
  } catch (error) {
    console.error("Generate Diagram Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Internal Server Error" 
    });
  }
};

module.exports = {
  startLesson,
  getLessonHistory,
  saveLessonData,
  generateDiagramEndpoint,
  generateDiagram
};