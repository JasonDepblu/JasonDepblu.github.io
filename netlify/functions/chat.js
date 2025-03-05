import fetch from 'node-fetch';
import { Pinecone } from '@pinecone-database/pinecone';
import { DynamoDB } from 'aws-sdk';

// Configurable timeout values (in milliseconds)
const CONFIG = {
  FETCH_TIMEOUT: 15000,          // 15 seconds for API calls
  PINECONE_TIMEOUT: 12000,       // 12 seconds for Pinecone operations
  DEEPSEEK_TIMEOUT: 20000,       // 20 seconds for DeepSeek model generation
  RETRY_COUNT: 2,                // Number of retries for failed operations
  RETRY_DELAY: 1000,             // Initial delay between retries (1 second)
  MAX_HISTORY_LENGTH: 10,        // Maximum number of turns to keep in history
  HISTORY_TTL: 60 * 60 * 24,     // TTL for chat history in seconds (24 hours)
};

// Initialize DynamoDB client
const dynamoDB = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Table name for chat history
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE || 'ChatHistory';

// Global cache for Pinecone client
let pineconeIndex = null;
let pineconeClient = null;

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

// Functions to manage chat history
async function getChatHistory(sessionId) {
  try {
    console.log(`Retrieving chat history for session: ${sessionId}`);
    const params = {
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId }
    };

    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      console.log(`Found history with ${result.Item.messages.length} messages`);
      return result.Item.messages;
    }

    console.log("No existing chat history found, starting new conversation");
    return [];
  } catch (error) {
    console.error("Error retrieving chat history:", error);
    // If there's an error, return empty history to continue the conversation
    return [];
  }
}

async function updateChatHistory(sessionId, messages) {
  try {
    console.log(`Updating chat history for session: ${sessionId} with ${messages.length} messages`);

    // Keep only the most recent messages according to CONFIG.MAX_HISTORY_LENGTH
    const truncatedMessages = messages.slice(-CONFIG.MAX_HISTORY_LENGTH);

    const params = {
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        sessionId,
        messages: truncatedMessages,
        updatedAt: Math.floor(Date.now() / 1000),
        ttl: Math.floor(Date.now() / 1000) + CONFIG.HISTORY_TTL
      }
    };

    await dynamoDB.put(params).promise();
    console.log("Chat history updated successfully");
  } catch (error) {
    console.error("Error updating chat history:", error);
    // Continue even if history update fails
  }
}

exports.handler = async (event, context) => {
  // Set context.callbackWaitsForEmptyEventLoop to false to prevent Lambda from waiting
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = JSON.parse(event.body);
    const question = body.question;
    const sessionId = body.sessionId || 'default-session'; // Use provided sessionId or default

    if (!question) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No question provided" }) };
    }

    // Retrieve chat history for this session
    const chatHistory = await getChatHistory(sessionId);

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
    console.log("没有找到与问题直接相关的参考资料。");

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
    const deepseekRes = await withTimeout(
      fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "Pro/deepseek-ai/DeepSeek-R1",
          messages: promptMessages,
          temperature: 0.6,
          // Optional parameters for better conversation handling
          max_tokens: 1000,         // Longer responses for complex questions
          frequency_penalty: 0.2,   // Slightly reduce repetition
          presence_penalty: 0.2     // Encourage mentioning new topics
        }),
      }),
      CONFIG.DEEPSEEK_TIMEOUT,
      "DeepSeek-R1 API call"
    );

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      throw new Error(`硅基流动 DeepSeek-R1 API 请求失败: ${deepseekRes.statusText} - ${errText}`);
    }

    const deepseekData = await deepseekRes.json();
    const assistantMessage = deepseekData.choices?.[0]?.message || { role: "assistant", content: "很抱歉，我无法生成回答。" };
    const answer = assistantMessage.content;
    console.log("使用硅基流动 DeepSeek-R1 模型生成回答成功");

    // Update chat history with the new message exchange
    const updatedHistory = [...chatHistory];
    updatedHistory.push({ role: 'user', content: question }); // Add user's question
    updatedHistory.push(assistantMessage); // Add assistant's response

    // Store updated history
    await updateChatHistory(sessionId, updatedHistory);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer,
        sessionId // Return the sessionId for the client to use in follow-up requests
      }),
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: err.message,
        // Include timeout indication if applicable
        isTimeout: err.message && err.message.includes("timed out")
      }),
    };
  }
};