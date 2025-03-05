import fetch from 'node-fetch';

// Configurable timeout values (in milliseconds)
const CONFIG = {
  DEEPSEEK_TIMEOUT: 26000,       // 26 seconds for DeepSeek model - maximum for Netlify
  RETRY_COUNT: 2,                // Number of retries for failed operations
  RETRY_DELAY: 1000,             // Initial delay between retries (1 second)
  MAX_HISTORY_LENGTH: 10,        // Maximum number of turns to keep in history
  MEMORY_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
};

// In-memory chat history storage
const chatHistoryStore = new Map();

// Helper function to implement timeout for promises
const withTimeout = (promise, timeoutMs, operationName) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

// Helper function to implement retry logic
const withRetry = async (operation, maxRetries, initialDelay, operationName) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.warn(`${operationName} attempt ${attempt + 1}/${maxRetries + 1} failed:`, error.message);
      lastError = error;

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};

// In-memory chat history management
function getChatHistory(sessionId) {
  // Clean up expired sessions first
  const now = Date.now();
  for (const [key, session] of chatHistoryStore.entries()) {
    if (now > session.expiry) {
      chatHistoryStore.delete(key);
      console.log(`Deleted expired session: ${key}`);
    }
  }

  // Get or create session
  const sessionData = chatHistoryStore.get(sessionId);
  if (sessionData) {
    console.log(`Found history with ${sessionData.messages.length} messages for session: ${sessionId}`);
    // Update expiry time on access
    sessionData.expiry = Date.now() + CONFIG.MEMORY_EXPIRY;
    return sessionData.messages;
  }

  console.log(`No history found for session: ${sessionId}, starting new conversation`);
  return [];
}

function updateChatHistory(sessionId, messages) {
  // Keep only the most recent messages
  const truncatedMessages = messages.slice(-CONFIG.MAX_HISTORY_LENGTH);

  chatHistoryStore.set(sessionId, {
    messages: truncatedMessages,
    expiry: Date.now() + CONFIG.MEMORY_EXPIRY
  });

  console.log(`Updated history for session: ${sessionId} with ${truncatedMessages.length} messages`);
  console.log(`Total active sessions: ${chatHistoryStore.size}`);
}

// Function to generate answer from DeepSeek API
async function generateAnswer(messages) {
  try {
    console.log("调用 DeepSeek-R1 模型生成回答...");
    console.log(`提示包含 ${messages.length} 条消息`);

    // First attempt - fully-featured call with history
    const response = await withTimeout(
      fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "Pro/deepseek-ai/DeepSeek-R1",
          messages: messages,
          temperature: 0.6,
          max_tokens: 1000,
          frequency_penalty: 0.2,
          presence_penalty: 0.2
        }),
      }),
      CONFIG.DEEPSEEK_TIMEOUT,
      "DeepSeek-R1 API call"
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error: ${response.statusText} - ${errText}`);
    }

    const result = await response.json();
    console.log("DeepSeek API 调用成功");
    return result.choices[0].message;
  } catch (error) {
    console.error("DeepSeek API 调用失败:", error.message);

    // If we've already tried multiple times with the full context, try with simplified context
    try {
      console.log("尝试简化请求后重试...");

      // Extract just the system prompt and the most recent user message
      const systemPrompt = messages[0]; // System prompt
      const userMessage = messages.find(msg => msg.role === 'user') || { role: 'user', content: '' };

      const simplifiedMessages = [
        systemPrompt,
        userMessage
      ];

      const fallbackResponse = await withTimeout(
        fetch("https://api.siliconflow.cn/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "Pro/deepseek-ai/DeepSeek-R1",
            messages: simplifiedMessages,
            temperature: 0.6,
            max_tokens: 800, // Reduce for faster response
          }),
        }),
        CONFIG.DEEPSEEK_TIMEOUT - 5000, // Reduce timeout for fallback
        "DeepSeek-R1 fallback API call"
      );

      if (!fallbackResponse.ok) {
        throw new Error(`Fallback API error: ${fallbackResponse.statusText}`);
      }

      const fallbackResult = await fallbackResponse.json();
      console.log("DeepSeek API 简化调用成功");

      // Add note about simplified context
      const assistantMessage = fallbackResult.choices[0].message;
      assistantMessage.content = "（注：由于响应时间限制，此回答基于简化的上下文）\n\n" + assistantMessage.content;

      return assistantMessage;
    } catch (fallbackError) {
      console.error("简化调用也失败:", fallbackError.message);
      throw new Error("无法获取AI回答，请稍后重试。");
    }
  }
}

exports.handler = async (event, context) => {
  const startTime = Date.now(); // Start timing execution

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Handle preflight requests for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      },
      body: ""
    };
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // Extract data from the RAG function
    const { sessionId, question, contextText, chatHistory: providedHistory } = body;

    if (!sessionId || !question || contextText === undefined) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required parameters" })
      };
    }

    // Merge provided history with stored history (if any)
    const storedHistory = getChatHistory(sessionId);
    const chatHistory = providedHistory && providedHistory.length > 0 ? providedHistory : storedHistory;

    // Construct conversation prompt with history
    let promptMessages = [
      { role: 'system', content: '你是一个技术论坛的AI助手，请根据下面的文章参考回答用户问题。如果没有相关参考资料，请告知用户你没有足够信息回答这个问题。保持对话的连贯性，记住用户之前提到的内容。' },
    ];

    // Add chat history to maintain context
    if (chatHistory.length > 0) {
      console.log(`Adding ${chatHistory.length} historical messages to the prompt`);
      promptMessages = [...promptMessages, ...chatHistory];
    }

    // Add current question with context
    promptMessages.push({ role: 'user', content: `问题：${question}\n\n文章参考：\n${contextText}` });

    // Call DeepSeek-R1 model to generate response
    const assistantMessage = await generateAnswer(promptMessages);
    console.log("获取到AI回答，长度:", assistantMessage.content.length);

    // Update chat history with the new message exchange
    const updatedHistory = [...chatHistory];
    updatedHistory.push({ role: 'user', content: question }); // Add user's question
    updatedHistory.push(assistantMessage); // Add assistant's response

    // Store updated history
    updateChatHistory(sessionId, updatedHistory);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: assistantMessage.content,
        sessionId, // Return the sessionId for the client to use in follow-up requests
        executionTime: Date.now() - startTime // Include execution time for debugging
      }),
    };
  } catch (err) {
    console.error("Error in LLM function:", err);

    // Create a user-friendly error message
    let errorMessage = "抱歉，获取回答失败。";
    if (err.message.includes("timed out")) {
      errorMessage = "回答生成超时，请稍后重试或尝试提出更简短的问题。";
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: errorMessage,
        details: process.env.NODE_ENV === "development" ? err.message : undefined,
        executionTime: Date.now() - startTime
      }),
    };
  }
}