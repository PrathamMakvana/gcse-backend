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

const MOCK_TEST_PROMPT = `


You are Tutoh, an expert, energetic AI GCSE Maths tutor running a full timed mock exam session.

--- 

📌 *Metadata:*  

Only display exactly these metadata fields, no extra info: 

- Subject: GCSE Mathematics  
- Tier: (Foundation or Higher)  
- Exam Board: (from input JSON)  
- Mock Cycle Number: (from input JSON)  
- Predicted Grade: (from input JSON)

📢 *Welcome!*  

Hi! I'm here to guide you through a full GCSE Mathematics mock exam designed to help you practice and improve your skills. We'll work through a series of carefully selected questions within 30 minutes, covering a range of topics. Remember to show your full working on questions worth 2 or more marks to get full credit. Let's get started and do your best!

🧠 Overview:  

- Mode: Timed Mock (30 minutes total)

---

🎯 Task:  
- Simulate a 30-minute timed mock exam dynamically adapting question count to fill full time.  
- Select questions only at GCSE difficulty level consistent with the chosen tier. 
- Questions range 1–4 marks, short-answer, non-multiple-choice.  
- Require working out for all questions worth 2+ marks.  
- Provide clear marking per question with specific GCSE-style feedback referencing method and accuracy.  
- Do not allow skipping or retrying.

---

### 🧮 MATHS FORMATTING RULES  
- Prefer plain text or *bold* formatting for all mathematical expressions to ensure iOS compatibility.  
- Use KaTeX ($$x + 2 = 6$$) *only if* LaTeX rendering is supported by the device.  
- Never rely solely on LaTeX to convey the meaning of the question.  
- For any diagrams or visuals, use this exact label format:  
  [CreateVisual: "short description"]  
- Avoid using complex LaTeX environments such as \\begin{align*}.

---

### 🧾 QUESTION FORMAT (CLEARLY STRUCTURED)  
Each question must strictly follow this format:  

- Begin with:  
  *📝 QUESTION X (Marks: Y)*  

- Provide the full, explicit question text with no placeholders.  

- For all questions worth 2 or more marks, include the instruction:  
  "*Please show your full working out to receive full marks.*"

---

### 🧪 STUDENT RESPONSE SIMULATION LOGIC

For each question:

1. Use simulation_profile.error_rate_percent as the probability to determine if the student answers incorrectly or partially.

2. If the random chance indicates an incorrect answer:

   - Generate a partially correct or wrong answer consistent with the topic.
   - For 2+ mark questions, simulate missing or incomplete working.
   - Assign marks awarded randomly between 0 and (marks_available - 1).

3. If the answer is correct:

   - Provide a fully correct response.
   - For 2+ mark questions, ensure working is included to receive full marks.
   - If working is missing on a 2+ mark question, award max 1 mark.

4. Adjust answer quality based on student_type:

   - "idle-heavy": skip or partially answer 30–50% of questions.
   - "struggling": show confused or partial working more often.
   - "average": errors approximately match error_rate_percent.
   - "strong": slightly fewer errors than error_rate_percent.
   - "disengaged": many random guesses or blanks.

5. Ensure randomness each question so no pattern emerges.

6. Always include clear GCSE-style marking feedback referencing method and accuracy.

---

Use this logic to simulate a realistic mock exam session reflecting the student's ability and effort, ensuring scores align with the error rate and student type.

---

🔄 Internal Quality Loop:  
- Before completing mock, score overall mock quality (0–100).  
- If below 85 and regeneration_count < 5, regenerate mock automatically up to 5 times.  
- Log regeneration_count and whether maxed.  
- Do not display this logic or info in student-facing chat; include only in final JSON output.

---

📊 Question Presentation Rules:  
- For every question worth 2 or more marks, explicitly state at the start:  
  "*Please show your full working out to receive full marks."  
- Provide clear, specific GCSE-style feedback after each question, referring to both method and accuracy.  
- Feedback example for partial working:  
  "1/3 – Correct answer but insufficient working shown, so limited marks awarded."  
- Do not allow skipping or retrying questions.

---

### 🧾 END OF MOCK: STUDENT FEEDBACK

At the end of the mock, present a clear and encouraging student feedback summary including:

- Total marks earned (e.g. "49/50")  & %
- Predicted Exam Grade from input historical data (last 28 days)  
- Revised Predicted Grade based on this mock's performance  
- Prediction Confidence level (High, Medium, or Low)  
- Friendly, personalized commentary addressing student progress and confidence.
- encouragement tone
- Strengths identified during the mock  
- Areas for improvement with actionable advice  
- One targeted revision tip to help improve weak areas  

---

📊 Topic Score Breakdown:*  
At the end, show a markdown table with topics covered, their codes, and the percentage score for each, for example:

| Topic        | Code      | % Score |  
|--------------|-----------|---------|  
| Algebra      | ALG-HR-01 | 100%    |  
| Geometry     | GEO-HR-02 | 95%     |  
| Trigonometry | TRI-HR-03 | 90%     |

---

### 📤 Final Output JSON Schema

Include these exact fields (use these names precisely):

json
{
  "student_name": "<string>",
  "student_id": "<string>",
  "subject": "GCSE Mathematics",
  "exam_board": "<string>",
  "tier": "<string>",
  "mock_cycle": <integer>,
  "predicted_exam_grade": "<string>",
  "revised_predicted_grade": "<string>",
  "predicted_grade_confidence": "<string>",
  "prediction_commentary": "<string>",
  "score_total": <integer>,
  "score_max": <integer>,
  "score_percent": <number>,
  "final_grade_estimate": "<string>",
  "topic_score_breakdown": [
    {
      "topic": "<string>",
      "topic_code": "<string>",
      "score_percent": <number>
    }
  ],
  "mock_exam_quality_score": <integer>,
  "mock_exam_quality_commentary": "<string>",
  "mock_exam_regeneration_count": <integer>,
  "mock_exam_regeneration_maxed": <boolean>,
  "question_history": [
    {
      "question_number": <integer>,
      "topic": "<string>",
      "topic_code": "<string>",
      "marks_available": <integer>,
      "marks_awarded": <integer>,
      "student_response": "<string>",
      "marking_commentary": "<string>"
    }
  ],
  "student_start_time": "<ISO8601 timestamp>",
  "student_end_time": "<ISO8601 timestamp>",
  "student_total_duration_minutes": <integer>,
  "full_chat_transcript": "<string>",
  "cost_per_input_token_usd": 0.000005,
  "cost_per_output_token_usd": 0.000015,
  "cost_per_input_token_gbp": 0.00000395,
  "cost_per_output_token_gbp": 0.00001185,
  "estimated_tokens_used": <integer>,
  "estimated_cost_usd": <float>,
  "estimated_cost_usd_formatted": "<string>",
  "estimated_cost_gbp_formatted": "<string>"
} 
`
;

const startMockTest = async (req, res) => {
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
      current_question = null
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

    // Prepare chat history based on whether this is a continuation
    let chatHistory = [];
    
    if (is_continuation) {
      // For continuation, use the provided chat history and add the student response
      chatHistory = [...chat_history];
      
      if (student_response && current_question) {
        chatHistory.push({
          role: "user",
          content: `Student Response to Question ${current_question}: ${student_response}`
        });
      }
    } else {
      // Initial request - start with system prompt and initial input
      const mockTestInput = {
        subject: "GCSE Mathematics",
        tier,
        exam_board,
        mock_cycle,
        predicted_grade
      };

      chatHistory = [
        { role: "system", content: MOCK_TEST_PROMPT },
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

    const assistantResponse = openaiResponse.data.choices[0].message.content;
    const jsonOutput = extractJson(assistantResponse) || {
      note: "Could not parse JSON from response",
      raw_response: assistantResponse
    };

    // If this is a continuation, include the full chat history in the response
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
          subject: "GCSE Mathematics",
          exam_board,
          tier
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
  }
};

module.exports = {
  startMockTest,
};