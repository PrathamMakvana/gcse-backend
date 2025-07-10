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

    // 2. Verify the tutoring_sessions table was created
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'tutoring_sessions'"
    );
    if (tables.length === 0) {
      throw new Error("Tutoring sessions table was not created");
    }

    // 3. Create session_messages table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS session_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        role ENUM('system', 'user', 'assistant') NOT NULL,
        content TEXT NOT NULL,
        timestamp VARCHAR(50),
        message_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session_timestamp (session_id, timestamp),
        INDEX idx_session_id (session_id)
      ) ENGINE=InnoDB
    `);

    // 4. Check if foreign key constraint already exists
    const [existingConstraints] = await connection.query(`
      SELECT CONSTRAINT_NAME 
      FROM information_schema.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'session_messages' 
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND CONSTRAINT_NAME = 'fk_session_id'
    `);

    // 5. Add foreign key constraint if it doesn't exist
    if (existingConstraints.length === 0) {
      try {
        await connection.query(`
          ALTER TABLE session_messages
          ADD CONSTRAINT fk_session_id
          FOREIGN KEY (session_id) REFERENCES tutoring_sessions(id) ON DELETE CASCADE
        `);
        console.log("✅ Foreign key constraint added successfully");
      } catch (fkError) {
        console.warn(
          "⚠️  Foreign key constraint failed, but tables are functional without it:",
          fkError.message
        );
        // Continue without foreign key - tables will still work
      }
    } else {
      console.log("✅ Foreign key constraint already exists");
    }

    console.log("✅ Database tables initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);

    // Additional diagnostic information
    if (connection) {
      try {
        const [engines] = await connection.query("SHOW ENGINES");
        console.log("Supported engines:", engines);

        const [fkCheck] = await connection.query(
          'SHOW VARIABLES LIKE "foreign_key_checks"'
        );
        console.log("Foreign key checks:", fkCheck);
      } catch (diagError) {
        console.error("Diagnostic failed:", diagError);
      }
    }

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

    // Normalize subject
    const normalizedSubject = subject.trim().toLowerCase();
    let subjectKey;

    // Handle different subject name variations
    if (normalizedSubject === "maths" || normalizedSubject === "mathematics") {
      subjectKey = "MATHS_PROMPT";
    } else if (normalizedSubject === "english language") {
      subjectKey = "ENGLISH_LANGUAGE_PROMPT";
    } else if (normalizedSubject === "english literature") {
      subjectKey = "ENGLISH_LITERATURE_PROMPT";
    } 
    else if (normalizedSubject === "combined science") {
      subjectKey = "COMBINED_SCIENCE_PROMPT";
    }
    else {
      return res.status(400).json({ 
        success: false, 
        error: `Unsupported subject: ${subject}` 
      });
    }

    // Verify exam board is supported for this subject
    const examBoards = {
      "MATHS_PROMPT": ["Edexcel"],
      "ENGLISH_LANGUAGE_PROMPT": ["AQA"],
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
      model: "gpt-4o",
      messages: chatHistory,
      temperature: 0.7,
      max_tokens: 4096,
    };

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

    // Store the assistant's response if it has valid content
    if (openaiResponse.data.choices?.[0]?.message?.content) {
      const assistantMessage = {
        role: "assistant",
        content: openaiResponse.data.choices[0].message.content,
        timestamp: new Date().toISOString(),
        id: Date.now().toString(),
      };

      await connection.query(
        `INSERT INTO session_messages 
         (session_id, role, content, timestamp, message_id) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          sessionId,
          assistantMessage.role,
          assistantMessage.content,
          assistantMessage.timestamp,
          assistantMessage.id,
        ]
      );
    }

    res.json({
      success: true,
      data: openaiResponse.data,
      sessionId: sessionId,
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
        const [messages] = await connection.query(
          `SELECT role, content, timestamp, message_id AS id 
           FROM session_messages 
           WHERE session_id = ? 
           ORDER BY timestamp ASC`,
          [session.id]
        );
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




// Add this to your backend code
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
        student_confidence_level, student_progress_trend
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?
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
        dataToSave.student_progress_trend
      ]
    );

    res.json({ 
      success: true, 
      data: { id: result.insertId } 
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



module.exports = {
  startLesson,
  getLessonHistory,
  saveLessonData
};
