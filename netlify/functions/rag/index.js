const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');

// Import the session utility
const { sessionManager } = require('../utils/session-manager');
const {
  initPinecone,
    safeFileOperation,
  storeConversationInPinecone,
    storeConversationLocally
} = require('../utils/vector-db');
// const {useState} = require("react");

// Environment variables
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const SILICONE_API_KEY = process.env.SILICONE_API_KEY; // Silicon Flow API key

// Model configuration
const EMBEDDING_MODEL = 'Pro/BAAI/bge-m3'; // Silicon Flow embedding model
const SILICON_CHAT_MODEL = 'Qwen/QwQ-32B'; // Model for RAG judgment (changed to QwQ-32B)
const SILICON_REASONING_MODEL = 'Qwen/QwQ-32B'; // Model for answer generation (changed to QwQ-32B)

// Detect Netlify environment
// const isNetlifyEnvironment = process.env.NETLIFY === 'true';
const isNetlifyEnvironment = 'true';
const TEMP_STORAGE_DIR = '/tmp'; // Netlify allows /tmp with restrictions

// Initialize Pinecone client with caching mechanism
let pineconeIndex = null;
let pineconeLastInitTime = 0;
const PINECONE_CACHE_TTL = 300000; // 5 minutes cache TTL

// Helper function for timing out operations in Netlify environment
async function withTimeout(promise, timeoutMs = 50000, fallbackValue = null) {
  if (!isNetlifyEnvironment) {
    return promise; // In non-Netlify environments, don't apply timeout
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    console.warn(`Operation timed out: ${error.message}`);
    return fallbackValue;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Get embedding from Silicon Flow API
async function getEmbedding(text) {
  try {
    console.log("Getting embedding for text using Silicon Flow API...");

    // Send request using axios
    try {
      // Use timeout wrapper for Netlify environment
      const embeddingPromise = axios.post(
        'https://api.siliconflow.cn/v1/embeddings',
        {
          model: EMBEDDING_MODEL,
          input: text
        },
        {
          headers: {
            'Authorization': `Bearer ${SILICONE_API_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; BlogAssistantAgent/1.0)',
            'Connection': 'keep-alive'
          },
          timeout: 50000 // 20 second timeout (for Netlify)
        }
      );

      const response = await withTimeout(embeddingPromise, 50000);

      if (!response || response.status !== 200) {
        throw new Error(`Error getting embedding: ${JSON.stringify(response?.data || "No response")}`);
      }

      console.log("Successfully generated embedding with axios");
      return response.data.data[0].embedding;
    } catch (axiosError) {
      console.error("Failed to get embedding with axios:", axiosError.message);

      // If timeout error, provide more specific error message
      if (axiosError.code === 'ECONNABORTED') {
        throw new Error("Embedding request timed out");
      }

      // If response contains detailed error information, extract it
      if (axiosError.response && axiosError.response.data) {
        throw new Error(`API Error: ${JSON.stringify(axiosError.response.data)}`);
      }

      throw axiosError;
    }
  } catch (error) {
    console.error("Failed to get embedding:", error);
    throw error;
  }
}

// Evaluate if RAG is needed using Silicon Flow's Qwen/QwQ-32B
async function evaluateNeedForRAG(question, conversationHistory) {
  try {

    // Build prompt to evaluate query
    const prompt = `
      你是一个决策智能体，负责确定是否需要外部知识来回答用户的问题。
      请评估以下查询，判断是否需要从知识库检索信息：
      
      用户问题: ${question}
      
      最近的对话历史:
      ${conversationHistory.slice(-3).map(item => `
      用户: ${item.user}
      助手: ${item.assistant}
      `).join('\n')}
      
      如果问题是关于指定该blog的内容或论文相关内容，涉及AI、大模型LLM、强化学习范围，请回答 "NEED_RAG"。
      如果问题是闲聊、打招呼、感谢或简单的后续问题（基于之前对话可以回答），请回答 "NO_RAG"。
      只返回 "NEED_RAG" 或 "NO_RAG"，不要有其他文字。
     `;

    try {
      // Use Silicon Flow Chat API for evaluation with timeout
      console.log("Using Silicon Flow Qwen/QwQ-32B API for evaluation...");

      // Prepare request for Silicon Flow API using Qwen/QwQ-32B
      const evaluationPromise = axios.post(
        'https://api.siliconflow.cn/v1/chat/completions',
        {
          model: SILICON_CHAT_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 10,
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${SILICONE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000 // 10 second timeout
        }
      );

      const response = await withTimeout(evaluationPromise, 10000, {
        data: { choices: [{ message: { content: "NEED_RAG" } }] }
      });

      console.log("RAG evaluation API response received");

      // Extract the decision from the response
      const decision = response?.data?.choices?.[0]?.message?.content?.trim() || "NEED_RAG";
      console.log(`RAG decision (Silicon Flow): ${decision}`);

      return decision.includes("NEED_RAG");
    } catch (error) {
      console.error("Silicon Flow API evaluation failed:", error.message);
      return true; // Default to using RAG
    }
  } catch (error) {
    console.error("Failed to evaluate need for RAG:", error);
    // Default to using RAG
    return true;
  }
}

// Retrieve context from Pinecone
// 修改 retrieveContext 函数
async function retrieveContext(queryEmbedding, topK = 3) {
  try {
    console.log("从 Pinecone 检索上下文...");

    // 使用 utility 初始化 Pinecone 客户端
    const index = await initPinecone(PINECONE_API_KEY, PINECONE_INDEX_NAME);

    // 查询 Pinecone
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true
    });

    // 处理结果
    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      return [];
    }

    return queryResponse.matches.map(match => ({
      content: match.metadata?.content || '',
      url: match.metadata?.url || '',
      title: match.metadata?.title || '',
      score: match.score || 0
    }));
  } catch (error) {
    console.error("Pinecone 查询错误:", error);
    return []; // 错误时返回空数组
  }
}

// Add general retry function
async function retryOperation(operation, maxRetries = 2, delay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries}...`);
      return await operation();
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      lastError = error;

      // No need to wait after last attempt
      if (attempt < maxRetries) {
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Increase delay, backoff strategy
        delay = delay * 1.5;
      }
    }
  }

  throw lastError;
}

// Generate answer using Silicon Flow Qwen/QwQ-32B
async function generateAnswer(question, contexts, usestream=false, conversationHistory = []) {
  try {
    console.log(`Generating answer for question using Silicon Flow LLM: ${question.substring(0, )}...`);

    // 2. Optimize conversation history - only keep recent 3 rounds and limit length
    const recentHistory = conversationHistory.slice(-5).map(item => ({
      user: item.user,
      // Limit each reply to 200 characters
      assistant: item.assistant?.length > 1000 ?
        item.assistant.substring(0, 1000) + "..." :
        item.assistant || ""
    }));

    // 3. Build system prompt
    let systemPrompt;
    let contextText = "";

    if (contexts.length > 0) {
      systemPrompt = `你是一个Blog AI Assistant，你的名字叫Mandy，根据提供的博客文章内容回答用户问题。如果提供的上下文中没有答案，请说明并给出你的最佳回答。
回答中应包含相关链接（如果有），保持回答简洁明了，直接针对用户问题。使用Markdown格式。`;

      contextText = contexts.map(ctx =>
        `标题: ${ctx.title}\n链接: ${ctx.url}\n内容: ${ctx.content}`
      ).join('\n\n');
    } else {
      systemPrompt = `你是一个友好的助手，你的名字叫Mandy，尽力回答用户的问题。
使用Markdown格式，保持回答简洁明了，直接针对用户问题。`;
    }

    // 4. Format conversation history - streamline
    const historyText = recentHistory.length > 0 ?
      recentHistory.map(item => `用户: ${item.user}\n助手: ${item.assistant}`).join('\n\n') :
      "";

    // 5. Build prompt - streamline based on conditions
    let userPrompt;
    if (contextText) {
      userPrompt = `### 博客文章内容:
${contextText}

${historyText ? `### 最近对话:\n${historyText}\n\n` : ''}

### 当前问题:
${question}

请根据提供的内容简明扼要地回答问题。`;
    } else {
      userPrompt = `${historyText ? `### 最近对话:\n${historyText}\n\n` : ''}

### 当前问题:
${question}

请简明扼要地回答问题。`;
    }

    // 6. Build messages array for API
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // Log request size
    const requestSize = JSON.stringify(messages).length;
    console.log(`Request size: ${requestSize} characters`);
    if (requestSize > 8000) {
      console.warn("Warning: Request size is very large, may cause issues");
    }

    // 7. Use retry logic to call Silicon Flow API
    try {
      const answer = await retryOperation(async () => {
        console.log("Calling Silicon Flow Qwen/QwQ-32B API...");

        // Make API request to Silicon Flow using Qwen/QwQ-32B with timeout for Netlify
        const apiPromise = axios.post(
          'https://api.siliconflow.cn/v1/chat/completions',

          {
            model: SILICON_REASONING_MODEL,
            messages: messages,
            temperature: 0.6,
            max_tokens: 2048,
            stream: usestream
          },
          {
            headers: {
              'Authorization': `Bearer ${SILICONE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 50000 // 20 second timeout for Netlify
          }
        );

        const completion = await withTimeout(apiPromise, 80000);

        if (!completion || !completion.data || !completion.data.choices ||
            !completion.data.choices[0] || !completion.data.choices[0].message) {
          throw new Error("Invalid or empty response from Silicon Flow API");
        }

        const responseContent = completion.data.choices[0].message.content;
        console.log("Answer generated successfully with Silicon Flow Qwen/QwQ-32B");
        return responseContent;
      }, 1, 2000); // Max 1 retry, initial 2 second delay (for Netlify time constraints)

      return answer;
    } catch (error) {
      console.error("Failed to generate answer with Silicon Flow Qwen/QwQ-32B:", error);
      throw new Error("Failed to generate answer with Silicon Flow Qwen/QwQ-32B");
    }
  } catch (error) {
    console.error("Failed to generate answer:", error);
  }
}


// And in updateSessionWithAnswer function:
function updateSessionWithAnswer(sessionId, requestId, question, answer) {
  try {
    console.log(`更新会话 ${sessionId} 的请求 ${requestId} 的答案`);

    // 使用单一更新调用
    sessionManager.updateSession(sessionId, {
      'history': [...(sessionManager.getSession(sessionId)?.history || []), {
        user: question,
        assistant: answer
      }],
      'current_request': {
        id: requestId,
        status: 'completed',
        answer: answer,
        completed_at: Date.now()
      }
    });

    // 更新 pendingRequests
    sessionManager.updateRequestStatus(sessionId, requestId, 'completed', {
      answer: answer,
      completed_at: Date.now()
    });

    // 立即保存
    sessionManager.saveNow();

    return true;
  } catch (error) {
    console.error("更新会话失败:", error);
    return false;
  }
}
// Process RAG request with Netlify timeout handling
async function processRagRequest(requestId, sessionId, question, usestream) {
  try {
    console.log(`Processing request ${requestId} for session ${sessionId}`);

    // Add timeout check for Netlify environment
    const startTime = Date.now();
    const timeoutCheck = () => {
      // Allow 5 seconds buffer before Netlify's 26s timeout
      if (isNetlifyEnvironment && Date.now() - startTime > 21000) {
        throw new Error('Function timeout approaching');
      }
    };

    // Get session history
    const session = sessionManager.getSession(sessionId) || {};
    const conversationHistory = session.history || [];

    // Use Silicon Flow Qwen/QwQ-32B to evaluate if RAG is needed
    const needsRAG = await evaluateNeedForRAG(question, conversationHistory);
    console.log("RAG is evaluated as needed:", needsRAG);

    let contexts = [];
    let queryEmbedding = null;

    // If RAG process is needed
    if (needsRAG) {
      console.log("RAG is needed for this question");

      // Periodic timeout check
      timeoutCheck();

      // Get embedding for question (using Silicon Flow API)
      try {
        queryEmbedding = await getEmbedding(question);
        console.log("Embedding obtained, length:", queryEmbedding?.length || 0);
      } catch (embeddingError) {
        console.error("Error getting embedding:", embeddingError);
        queryEmbedding = null;
      }

      // Periodic timeout check
      timeoutCheck();

      // Retrieve relevant contexts
      if (queryEmbedding && queryEmbedding.length > 0) {
        try {
          contexts = await retrieveContext(queryEmbedding);
          console.log("Context retrieved, count:", contexts);
        } catch (contextError) {
          console.error("Error retrieving context:", contextError);
          contexts = []; // Ensure contexts is empty array not undefined
        }
      }
    } else {
      console.log("Skipping RAG based on question evaluation");
    }

    // Periodic timeout check
    timeoutCheck();

    // 构建包含上下文的系统提示
    let systemPrompt = "你是一个Blog AI Assistant，你的名字叫Mandy.";
    // systemPrompt += conversationHistory;
    console.log("system prompt");
    if (contexts.length > 0) {
      systemPrompt += "若问题与blog内容（AI & LLM等技术）不相关，则答复拒绝，如果与以下内容相关，根据提供的博客文章内容回答用户问题：\n\n";
      systemPrompt += contexts.map(ctx =>
        `标题: ${ctx.title}\n链接: ${ctx.url}\n内容: ${ctx.content}`
      ).join('\n\n');
    } else {
      systemPrompt += "请使用中文回答以下问题,若问题与blog内容（AI & LLM等技术）不相关，则答复拒绝。";
    }
    const userPrompt = `${question}\n${JSON.stringify(conversationHistory)}`;
    console.log("system prompt：", systemPrompt);
    console.log("whether the usestream is true：", usestream);
    console.log("userPrompt：", userPrompt);

     // 声明答案变量
    let answer;
    // If streaming is requested
    if (usestream) {
      console.log("Stream mode requested, preparing streaming configuration");

      // Create streaming configuration
      const streamConfig = {
        apiEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        apiKey: SILICONE_API_KEY,
        model: SILICON_REASONING_MODEL,
        messages: [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: userPrompt}
        ],
        parameters: {
          temperature: 0.7,
          max_tokens: 2048,
          top_p: 0.9
        }
      };

      sessionManager.updateRequestStatus(sessionId, requestId, 'completed', {
        streamConfig: streamConfig,
        completed_at: Date.now()
      });
      sessionManager.saveNow();

      // console.log("testing streamConfig", streamConfig);
      response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          question,
          requestId: requestId,
          sessionId: sessionId,
          streamConfig: streamConfig,
          stream: usestream,
          status: "streaming_prepared",
          timestamp: Date.now()
        })
      }
      console.log("return", JSON.parse(response.body).streamConfig);
      // Return streaming configuration for frontend to handle
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          question,
          requestId: requestId,
          sessionId: sessionId,
          streamConfig: streamConfig,
          stream: usestream,
          status: "streaming_prepared",
          timestamp: Date.now()
        })
      }
    }else {

      // Generate answer using Silicon Flow Qwen/QwQ-32B for non-streaming mode
      answer = await generateAnswer(
          question,
          contexts,
          usestream,
          conversationHistory
      );
      console.log(`generate： ${answer} .`);
      // Update session with the answer
      updateSessionWithAnswer(sessionId, requestId, question, answer);

      // Asynchronously store conversation to Pinecone (don't wait for completion)
      try {
        storeConversationInPinecone(
            question,
            answer,
            sessionId,
            PINECONE_API_KEY,
            PINECONE_INDEX_NAME,
            getEmbedding
        ).catch(error => console.error("Background conversation storage failed:", error));
      } catch (storageError) {
        console.error("Error initiating conversation storage:", storageError);
      }

      console.log(`Request ${requestId} processing completed successfully.`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          answer: answer,
          requestId: requestId,
          sessionId: sessionId,
          stream: usestream,
          status: "completed",
          timestamp: Date.now()
        })
      };
    }

  } catch (error) {
    console.error(`Error processing request ${requestId}:`, error);

    // Update request status to failed
    try {
      sessionManager.updateRequestStatus(sessionId, requestId, 'failed', {
        error: error.message,
        completed_at: Date.now()
      });
      sessionManager.saveNow();
    } catch (sessionError) {
      console.error("Failed to update session with error:", sessionError);
    }

    // Return a failure message instead of throwing an error
    // return `对不起，我无法处理这个请求。请稍后再试。`;
        // 返回标准化的错误响应对象，而不是字符串
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        error: "处理请求时出错: " + error.message,
        requestId: requestId,
        sessionId: sessionId,
        status: "failed",
        timestamp: Date.now()
      })
    };
  }
}

// Warmup connections - optimized for Netlify
async function warmupConnections() {
  try {
    console.log("Pre-warming API connections...");

    // Run warmup tasks in parallel with timeouts
    await Promise.allSettled([
      withTimeout(initPinecone(), 5000).catch(err =>
        console.log("Pinecone warmup completed with error:", err.message)),

      withTimeout(getEmbedding("warmup query"), 5000).catch(err =>
        console.log("Embedding API warmup completed with error:", err.message)),

      // Check Silicon Flow API connection
      withTimeout(axios.post(
        'https://api.siliconflow.cn/v1/chat/completions',
        {
          model: SILICON_CHAT_MODEL,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5,
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${SILICONE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      ), 5000).catch(err => console.log("Silicon Flow API warmup completed with error:", err.message))
    ]);

    console.log("API connections pre-warmed");
    return true;
  } catch (error) {
    console.error("Connection warmup failed (continuing):", error);
    return false;
  }
}




// Modified main handler function
exports.handler = async (event, context) => {
  // Set callbackWaitsForEmptyEventLoop to false for Netlify background processing
  console.log("RAG函数被调用", {
    method: event.httpMethod,
    path: event.path
  });
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  // initialization
  const requestId = crypto.randomUUID();

  // Add support for OPTIONS requests for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: "Method not allowed. Use POST." })
    };
  }

  if (!SILICONE_API_KEY || SILICONE_API_KEY.trim() === '') {
      console.error("Missing API key for Silicon Flow service");
      throw new Error("Silicon Flow API key is not configured");
    }

  try {
    console.log("RAG function called");
    console.log("HTTP Method:", event.httpMethod);
    console.log(`Generated request ID: ${requestId}`);

    // Parse request body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: "Invalid JSON in request body" })
      };
    }

    const question = body.question || '';
    let sessionId = body.sessionId;
    const usestream = body.stream === true; // Check if streaming is requested

    console.log(`Question received: ${question}`);
    console.log(`Stream mode requested: ${usestream}`);

    if (!question || question.trim() === '') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: "Question cannot be empty" })
      };
    }

    // Create or get session
    // In rag/index.js - Add debugging for session management
    // When creating a session or handling a request, add more logging:
    if (!sessionId || !sessionManager.getSession(sessionId)) {
      sessionId = crypto.randomUUID();
      console.log(`Generated new UUID: ${sessionId}`);

      // Use updateSession to set up the session
      sessionManager.updateSession(sessionId, 'history', []);
      sessionManager.updateSession(sessionId, 'created_at', Date.now());

      // Verify the session was created
      const verifySession = sessionManager.getSession(sessionId);
      console.log(`Verified session exists: ${!!verifySession}`);
      console.log(`Created new session: ${sessionId}`);
    } else {
      // Log the exact session ID that was found
      console.log(`Found existing session: ${sessionId}`);
      console.log(`Session data preview:`, JSON.stringify(sessionManager.getSession(sessionId)?.history?.length || 0));
    }

    // After creating/getting the session, initialize request in session
    sessionManager.updateRequestStatus(sessionId, requestId, 'processing', {
      question: question,
      started_at: Date.now()
    });

    // 立即保存会话以确保数据持久化
    sessionManager.saveNow();

    console.log(`已创建并保存请求 ${requestId} 到会话 ${sessionId}`);

    // // Start processing but don't wait for completion (async mode)
    // Promise.resolve().then(() => {
    //   processRagRequest(requestId, sessionId, question, usestream).catch(error => {
    //     console.error(`Background processing failed for request ${requestId}:`, error);
    //   });
    // });
      // Wait for the result directly
    const result = await processRagRequest(requestId, sessionId, question, usestream);
    // console.log(`结果是 ${result.json()}`);
    // Return the actual result to the client
    return result;


    // Return request ID for client polling
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        requestId: requestId,
        sessionId: sessionId,
        message: "Request is being processed",
        status: "processing"
      })
    };
  } catch (error) {
    console.error("Error in handler:", error);
    console.error("Error stack:", error.stack);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};

// Function for initialization - can be used for warmup
exports.init = async () => {
  try {
    // Pre-warm connections with timeout
    const warmupSuccess = await withTimeout(warmupConnections(), 10000, false);
    return { success: warmupSuccess };
  } catch (error) {
    console.error("Initialization failed:", error);
    return { success: false, error: error.message };
  }
};