import fetch from 'node-fetch';
import { Pinecone } from '@pinecone-database/pinecone';

// Configurable timeout values (in milliseconds)
const CONFIG = {
  FETCH_TIMEOUT: 15000,          // 15 seconds for API calls
  PINECONE_TIMEOUT: 12000,       // 12 seconds for Pinecone operations
  DEEPSEEK_TIMEOUT: 30000,       // 30 seconds for DeepSeek model generation (increased)
  RETRY_COUNT: 2,                // Number of retries for failed operations
  RETRY_DELAY: 1000,             // Initial delay between retries (1 second)
  MAX_HISTORY_LENGTH: 10,        // Maximum number of turns to keep in history
  MEMORY_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  NETLIFY_FUNCTION_TIMEOUT: 25000, // Netlify function timeout (26 seconds max for Netlify)
};

// In-memory chat history storage (will reset when function cold starts)
// For Netlify Functions, this will be maintained during container reuse
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

// Global cache for Pinecone client
let pineconeIndex = null;
let pineconeClient = null;

// Initialize Pinecone with retry and timeout
async function initPinecone() {
  if (pineconeIndex) return pineconeIndex;

  return withRetry(async () => {
    try {
      console.log("正在初始化 Pinecone...");
      console.log(`API Key: ${process.env.PINECONE_API_KEY ? "已设置" : "未设置"}`);
      console.log(`索引名称: ${process.env.PINECONE_INDEX}`);

      // Create Pinecone client with timeout
      pineconeClient = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
      });

      console.log("Pinecone 客户端创建成功");

      // Get index instance with timeout
      pineconeIndex = await withTimeout(
        pineconeClient.index(process.env.PINECONE_INDEX),
        CONFIG.PINECONE_TIMEOUT,
        "Pinecone index initialization"
      );

      console.log("Pinecone index 初始化成功");
      return pineconeIndex;
    } catch (err) {
      console.error("初始化 Pinecone 出错:", err);
      throw err;
    }
  }, CONFIG.RETRY_COUNT, CONFIG.RETRY_DELAY, "Pinecone initialization");
}

// Query function with timeout and retry
async function safeQuery(vector, topK = 5, includeMetadata = true) {
  return withRetry(async () => {
    try {
      const idx = await initPinecone();

      // Ensure vector is an array
      if (!Array.isArray(vector)) {
        console.error("向量不是数组格式:", typeof vector);
        throw new Error("查询向量必须是数组");
      }

      console.log("准备查询 Pinecone...");
      console.log(`向量维度: ${vector.length}`);
      console.log("向量前5个元素示例:", vector.slice(0, 5));

      // Execute query with timeout
      const queryResponse = await withTimeout(
        idx.query({
          vector: vector,
          topK: topK,
          includeMetadata: includeMetadata,
        }),
        CONFIG.PINECONE_TIMEOUT,
        "Pinecone query"
      );

      return queryResponse;
    } catch (error) {
      console.error("Pinecone 查询失败:", error);
      // Empty match result on final failure
      return { matches: [] };
    }
  }, CONFIG.RETRY_COUNT, CONFIG.RETRY_DELAY, "Pinecone query");
}

// Embed text with timeout and retry
async function embedText(text) {
  return withRetry(async () => {
    try {
      console.log("使用SiliconFlow API生成嵌入向量...");

      const response = await withTimeout(
        fetch("https://api.siliconflow.cn/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`
          },
          body: JSON.stringify({
            model: "Pro/BAAI/bge-m3",
            input: text
          })
        }),
        CONFIG.FETCH_TIMEOUT,
        "SiliconFlow embedding API"
      );

      if (!response.ok) {
        throw new Error(`Embedding API request failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("嵌入API响应成功");

      // Log response structure
      console.log("嵌入响应结构:", JSON.stringify(Object.keys(result)));
      if (result.data) {
        console.log("data结构:", JSON.stringify(Object.keys(result.data)));
        if (Array.isArray(result.data)) {
          console.log("data数组长度:", result.data.length);
          if (result.data.length > 0) {
            console.log("data[0]结构:", JSON.stringify(Object.keys(result.data[0])));
          }
        }
      }

      // Extract vector data
      let embedding = null;
      if (result.data && Array.isArray(result.data) && result.data.length > 0 && result.data[0].embedding) {
        console.log("从result.data[0].embedding中提取向量");
        embedding = result.data[0].embedding;
      } else if (result.data && result.data.embedding) {
        console.log("从result.data.embedding中提取向量");
        embedding = result.data.embedding;
      } else if (result.embedding) {
        console.log("从result.embedding中提取向量");
        embedding = result.embedding;
      }

      if (!embedding) {
        console.error("无法找到嵌入向量，返回完整响应:", JSON.stringify(result).substring(0, 200) + "...");
        throw new Error("无法从响应中提取向量数据");
      }

      // Ensure vector is an array
      if (!Array.isArray(embedding)) {
        console.log("嵌入向量不是数组，尝试转换...");
        if (typeof embedding === 'object') {
          embedding = Object.values(embedding);
        } else {
          throw new Error("无法将嵌入向量转换为数组");
        }
      }

      // Check element types
      const sampleCheck = embedding.slice(0, 5);
      console.log("向量前5个元素:", sampleCheck);
      console.log("向量前5个元素类型:", sampleCheck.map(item => typeof item));

      console.log(`成功生成向量，维度: ${embedding.length}`);
      return embedding;
    } catch (error) {
      console.error("生成嵌入向量失败:", error);
      throw error;
    }
  }, CONFIG.RETRY_COUNT, CONFIG.RETRY_DELAY, "Text embedding");
}

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

// Function to handle DeepSeek API calls with fallback
async function generateAnswer(messages) {
  try {
    console.log("调用 DeepSeek-R1 模型生成回答...");
    console.log(`提示包含 ${messages.length} 条消息`);

    // First attempt - fully-featured call with history
    const fullResponse = await withTimeout(
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

    if (!fullResponse.ok) {
      const errText = await fullResponse.text();
      throw new Error(`DeepSeek API error: ${fullResponse.statusText} - ${errText}`);
    }

    const result = await fullResponse.json();
    console.log("DeepSeek API 调用成功");
    return result.choices[0].message;
  } catch (error) {
    console.error("DeepSeek API 调用失败:", error.message);

    // If we exceed our function timeout limits, return an error message
    const executionTime = Date.now() - startTime;
    if (executionTime > CONFIG.NETLIFY_FUNCTION_TIMEOUT - 5000) { // 5s buffer
      throw new Error("处理时间超出限制，请重试或简化您的问题。");
    }

    // Fallback attempt - simplify to just the most recent message
    try {
      console.log("尝试简化请求后重试...");

      // Extract just the system prompt and the most recent user message
      const simplifiedMessages = [
        messages[0], // System prompt
        messages[messages.length - 1] // Latest user message
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

// Track execution time
let startTime;

exports.handler = async (event, context) => {
  startTime = Date.now(); // Start timing execution

  // Set context.callbackWaitsForEmptyEventLoop to false if in AWS Lambda
  if (context && typeof context.callbackWaitsForEmptyEventLoop !== 'undefined') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

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
    const question = body.question;

    // Generate a random session ID if not provided
    const sessionId = body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    if (!question) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No question provided" }) };
    }

    // Retrieve chat history for this session
    const chatHistory = getChatHistory(sessionId);

    // 1. Vectorize question
    const queryVector = await embedText(question);
    console.log("问题向量生成成功，维度:", queryVector.length);

    // Check if we're approaching the timeout limit
    const afterEmbeddingTime = Date.now() - startTime;
    if (afterEmbeddingTime > CONFIG.NETLIFY_FUNCTION_TIMEOUT - 15000) { // If more than 10 seconds elapsed
      throw new Error("处理时间过长，请重试。");
    }

    // 2. Query Pinecone vector database
    const pineconeResult = await safeQuery(queryVector, 5, true);
    const matches = pineconeResult.matches || [];
    console.log("Pinecone 查询结果数量:", matches.length);

    // 3. Organize retrieved context text
    let contextText = "";
    matches.forEach((match, idx) => {
      contextText += `【参考${idx + 1}】${match.metadata?.title || "未知标题"}: ${match.metadata?.content || "无内容"}\n`;
    });

    // If no matches, provide a friendly response
    if (matches.length === 0) {
      contextText = "没有找到与问题直接相关的参考资料。";
    }
    console.log(contextText);

    // 4. Construct conversation prompt with history
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

    // 5. Call SiliconFlow API using DeepSeek-R1 model to generate response
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
    console.error("Error:", err);

    // Create a user-friendly error message
    let errorMessage = "抱歉，获取回答失败。";
    if (err.message.includes("timed out")) {
      errorMessage = "回答生成超时，请稍后重试或尝试提出更简短的问题。";
    } else if (err.message.includes("处理时间")) {
      errorMessage = err.message;
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