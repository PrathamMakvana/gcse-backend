const axios = require("axios");
const mysql = require("mysql2/promise");

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

const PROMPT_API_URL = "https://laravel.tutoh.ai/api/get-prompt/";
console.log('=============> process.env.OPENAI_API_KEY =================>' + process.env.OPENAI_API_KEY);
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

const startMockTest = async (req, res) => {
  let connection;
  try {
    const {
      student_id,
      student_name,
      exam_board = "AQA",
      tier = "Higher",
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
      console.log("Successfully fetched prompt from API for type:", promptType);
    } catch (error) {
      console.error("Error fetching prompt from API:", error);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch prompt for subject: ${subject} and type: ${exam_type}`
      });
    }

    // Prepare chat history based on whether this is a continuation
    let chatHistory = [];
    
    if (is_continuation) {
      chatHistory = [...chat_history];
      if (student_response && current_question) {
        chatHistory.push({
          role: "user",
          content: `Student Response to Question ${current_question}: ${student_response}`
        });
      }
    } else {
      const mockTestInput = {
        subject,
        tier,
        exam_board,
        mock_cycle,
        predicted_grade,
      };

      chatHistory = [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(mockTestInput) }
      ];
    }

    const payload = {
      model: "gpt-4.1",
      messages: chatHistory,
      temperature: 1,
      max_tokens: 4096,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let assistantResponse = openaiResponse.data.choices[0].message.content;

    // Process any visual requests in the response
    assistantResponse = await processVisualRequests(assistantResponse);

    // Extract JSON output from the response
    const jsonOutput = extractJson(assistantResponse) || {
      note: "Could not parse JSON from response",
      raw_response: assistantResponse
    };

    if (is_continuation) {
      chatHistory.push({
        role: "assistant",
        content: assistantResponse
      });
    }

    
    res.json({
      success: true,
      data: {
        ...jsonOutput,
        chat_history: is_continuation ? chatHistory : [
          ...chatHistory,
          { role: "assistant", content: assistantResponse }
        ],
        openai_response: openaiResponse.data,
        session_data: {
          student_id,
          student_name,
          subject,
          exam_board,
          tier,
        }
      }
    });

  } catch (error) {
    console.error("Mock Test Error:", error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error?.response?.data?.error?.message || "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (connection) connection.release();
  }
};


module.exports = {
  startMockTest,
};
