import fetch from 'node-fetch';
import { Pinecone } from '@pinecone-database/pinecone';

// Configurable timeout values (in milliseconds)
const CONFIG = {
  FETCH_TIMEOUT: 15000,          // 15 seconds for API calls
  PINECONE_TIMEOUT: 8000,        // 8 seconds for Pinecone operations
  RETRY_COUNT: 1,                // Number of retries for failed operations
  RETRY_DELAY: 500,              // Initial delay between retries (0.5 second)
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
        console.error("无法找到嵌入向量");
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

    // 4. Prepare data for the LLM function
    const promptData = {
      sessionId,
      question,
      contextText,
      chatHistory
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: promptData,
        executionTime: Date.now() - startTime
      }),
    };
  } catch (err) {
    console.error("Error in RAG function:", err);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "RAG处理失败",
        details: process.env.NODE_ENV === "development" ? err.message : undefined,
        executionTime: Date.now() - startTime
      }),
    };
  }
}