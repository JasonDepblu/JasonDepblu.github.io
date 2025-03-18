const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios'); // Used for API requests
const { Pinecone } = require('@pinecone-database/pinecone');

 // * 独立会话存储实现
 // * 此实现不依赖外部session_store.js模块
 // */
const SESSION_DIR = '/tmp'; // 直接定义会话存储目录
const SESSION_FILE = path.join(SESSION_DIR, 'sessions.json');

const sessionManager = (() => {
  // 内存会话存储
  let sessions = {};

  // 健壮的文件读取
  const safeReadFile = (filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
    }
    return null;
  };

  // 健壮的JSON解析
  const safeParseJSON = (jsonString) => {
    if (!jsonString) return null;

    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.error("JSON parse error:", error);
      return null;
    }
  };

  // 健壮的文件写入
  const safeWriteFile = (filePath, data) => {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error);
      return false;
    }
  };

  // 重置会话文件
  const resetSessionFile = () => {
    console.log("Resetting session file due to corruption");
    return safeWriteFile(SESSION_FILE, {});
  };

  // 加载会话
  const loadSessions = () => {
    try {
      // 尝试读取文件
      const data = safeReadFile(SESSION_FILE);

      // 如果文件不存在或为空，初始化为空对象
      if (!data) {
        console.log("No session file or empty file, using empty sessions");
        return {};
      }

      // 尝试解析JSON
      const parsed = safeParseJSON(data);

      // 如果解析失败，重置文件并使用空对象
      if (!parsed) {
        console.log("Invalid session data, resetting file");
        resetSessionFile();
        return {};
      }

      console.log(`Loaded ${Object.keys(parsed).length} sessions from file`);
      return parsed;
    } catch (error) {
      console.error('Failed to load sessions:', error);
      return {};
    }
  };

  // 保存会话
  const saveSessions = () => {
    try {
      // 确保sessions是一个对象
      if (typeof sessions !== 'object' || sessions === null) {
        console.error("Invalid sessions object, not saving");
        return false;
      }

      const result = safeWriteFile(SESSION_FILE, sessions);
      if (result) {
        console.log(`Saved ${Object.keys(sessions).length} sessions to file`);
      }
      return result;
    } catch (error) {
      console.error('Failed to save sessions:', error);
      return false;
    }
  };

  // 尝试初始加载
  try {
    sessions = loadSessions() || {};
  } catch (error) {
    console.warn('Sessions not loaded on startup:', error);
    sessions = {};
  }

  // 定期保存会话
  let saveInterval = null;
  const startAutoSave = () => {
    if (saveInterval) clearInterval(saveInterval);
    saveInterval = setInterval(() => {
      saveSessions();
    }, 30000);
  };

  // 开始定期保存
  startAutoSave();

  // 公开API
  return {
    getSession(sessionId) {
      return sessions[sessionId];
    },

    setSession(sessionId, data) {
      sessions[sessionId] = data;
      return true;
    },

    updateSession(sessionId, field, value) {
      if (!sessions[sessionId]) {
        sessions[sessionId] = {};
      }
      sessions[sessionId][field] = value;
      return true;
    },

    deleteSession(sessionId) {
      if (sessions[sessionId]) {
        delete sessions[sessionId];
        return true;
      }
      return false;
    },

    getAllSessions() {
      return {...sessions};
    },

    // 额外方法
    saveNow() {
      return saveSessions();
    },

    resetSessions() {
      sessions = {};
      return resetSessionFile();
    }
  };
})();

const sessionStore = sessionManager;

// Environment variables
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const SILICONE_API_KEY = process.env.SILICONE_API_KEY; // Silicon Flow API key

// Model configuration
const EMBEDDING_MODEL = 'Pro/BAAI/bge-m3'; // Silicon Flow embedding model
const SILICON_CHAT_MODEL = 'Qwen/QwQ-32B'; // Model for RAG judgment (changed to QwQ-32B)
const SILICON_REASONING_MODEL = 'Qwen/QwQ-32B'; // Model for answer generation (changed to QwQ-32B)

// Simple greeting cache
const GREETING_CACHE = {
  "hi": "你好！我是博客助手，可以回答您关于博客内容的问题。有什么可以帮助您的吗？",
  "hello": "你好！有什么我可以帮助你的吗？",
  "hey": "嗨！有什么我可以帮助你的吗？",
  "你好": "你好！有什么我可以帮助你的吗？",
  "hello there": "你好！很高兴为您服务。请问有什么问题吗？",
  "嗨": "嗨！我是博客助手，很高兴能帮助您。",
  "哈喽": "哈喽！请问有什么可以帮助您的？"
};

// Detect Netlify environment
const isNetlifyEnvironment = process.env.NETLIFY === 'true';
const TEMP_STORAGE_DIR = '/tmp'; // Netlify allows /tmp with restrictions

// Initialize Pinecone client with caching mechanism
let pineconeIndex = null;
let pineconeLastInitTime = 0;
const PINECONE_CACHE_TTL = 300000; // 5 minutes cache TTL

// Quick pre-filter without calling LLM
function quickEvaluateNeedForRAG(question) {
  // Convert question to lowercase and trim whitespace
  const normalizedQuestion = question.toLowerCase().trim();

  // Check for direct cache match
  if (GREETING_CACHE[normalizedQuestion] !== undefined) {
    return false; // No need for RAG, use cache
  }

  // Simple greeting patterns
  const greetingPatterns = [
    /^(hi|hello|hey|howdy|greetings|哈喽|你好)(\s.*)?$/,
    /^(good\s)?(morning|afternoon|evening|day)(\s.*)?$/,
    /^how are you(\s.*)?$/,
    /^what'?s up(\s.*)?$/
  ];

  // Check if any greeting pattern matches
  for (const pattern of greetingPatterns) {
    if (pattern.test(normalizedQuestion)) {
      return false; // No need for RAG
    }
  }

  return null; // Undetermined, needs further evaluation
}

// Update Pinecone initialization function with cacheing for Netlify
// 更新后的 initPinecone 函数
async function initPinecone() {
  try {
    const now = Date.now();

    // 如果缓存实例仍然有效（在 TTL 内），则返回它
    if (pineconeIndex && now - pineconeLastInitTime < PINECONE_CACHE_TTL) {
      console.log("使用缓存的 Pinecone 客户端");
      return pineconeIndex;
    }

    console.log("初始化 Pinecone 客户端...");

    // 检查 API 密钥是否存在
    if (!PINECONE_API_KEY) {
      throw new Error("缺少 Pinecone API 密钥");
    }

    // 使用官方推荐的简化初始化方式
    const pinecone = new Pinecone({
      apiKey: PINECONE_API_KEY
    });

    console.log(`Pinecone 索引名称: ${PINECONE_INDEX_NAME}`);

    // 通过 describeIndex 方法验证索引的有效性
    try {
      await pinecone.describeIndex(PINECONE_INDEX_NAME);
    } catch (indexError) {
      console.error(`无法验证索引 ${PINECONE_INDEX_NAME}:`, indexError.message);
      throw new Error(`Pinecone 索引 "${PINECONE_INDEX_NAME}" 不存在或无法访问`);
    }

    // 获取索引实例
    pineconeIndex = pinecone.Index(PINECONE_INDEX_NAME);

    // 更新缓存时间戳
    pineconeLastInitTime = now;
    console.log("Pinecone 客户端初始化成功");

    return pineconeIndex;
  } catch (error) {
    console.error("初始化 Pinecone 失败:", error);
    throw error;
  }
}

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

    // Check if API key is valid
    if (!SILICONE_API_KEY || SILICONE_API_KEY.trim() === '') {
      console.error("Missing API key for Silicon Flow embedding service");
      throw new Error("Silicon Flow API key is not configured");
    }

    console.log("Silicon Flow API key status:", SILICONE_API_KEY ? "Key present" : "Key missing");

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
    // First do quick evaluation
    const quickResult = quickEvaluateNeedForRAG(question);
    if (quickResult !== null) {
      console.log(`Quick RAG evaluation: ${quickResult ? "NEED_RAG" : "NO_RAG"}`);
      return quickResult;
    }

    console.log("Evaluating if RAG is needed using Silicon Flow Qwen/QwQ-32B...");

    // Check if API key is valid
    if (!SILICONE_API_KEY || SILICONE_API_KEY.trim() === '') {
      console.error("Missing API key for Silicon Flow service");
      throw new Error("Silicon Flow API key is not configured");
    }

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
      
      如果问题是关于具体知识、博客内容、特定话题或需要最新信息，请回答 "NEED_RAG"。
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
          temperature: 0.3,
          max_tokens: 50,
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${SILICONE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
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
async function retrieveContext(queryEmbedding, topK = 3) {
  try {
    console.log("Retrieving context from Pinecone...");

    // Initialize Pinecone client
    const index = await initPinecone();

    // Use the correct query format for Pinecone SDK v1.x
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true
    });

    // Process results correctly
    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      return [];
    }

    // Map results properly
    return queryResponse.matches.map(match => ({
      content: match.metadata?.content || '',
      url: match.metadata?.url || '',
      title: match.metadata?.title || '',
      score: match.score || 0
    }));
  } catch (error) {
    console.error("Pinecone query error:", error);
    return []; // Return empty array on error
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
async function generateAnswer(question, contexts, conversationHistory = []) {
  try {
    console.log(`Generating answer for question using Silicon Flow Qwen/QwQ-32B: ${question.substring(0, 50)}...`);

    // Check if API key is valid
    if (!SILICONE_API_KEY || SILICONE_API_KEY.trim() === '') {
      console.error("Missing API key for Silicon Flow service");
      throw new Error("Silicon Flow API key is not configured");
    }

    // 1. Optimize contexts - limit quantity and length
    let optimizedContexts = [];
    if (contexts && contexts.length > 0) {
      // Only take top 3 most relevant contexts
      optimizedContexts = contexts.slice(0, 3).map(ctx => ({
        title: ctx.title,
        url: ctx.url,
        // Limit each context content to 600 characters
        content: ctx.content?.length > 600 ? ctx.content.substring(0, 600) + "..." : ctx.content || ""
      }));
    }

    // 2. Optimize conversation history - only keep recent 3 rounds and limit length
    const recentHistory = conversationHistory.slice(-3).map(item => ({
      user: item.user,
      // Limit each reply to 200 characters
      assistant: item.assistant?.length > 200 ?
        item.assistant.substring(0, 200) + "..." :
        item.assistant || ""
    }));

    // 3. Build system prompt
    let systemPrompt;
    let contextText = "";

    if (optimizedContexts.length > 0) {
      systemPrompt = `你是一个Blog Assistant，你的名字叫Mandy，根据提供的博客文章内容回答用户问题。如果提供的上下文中没有答案，请说明并给出你的最佳回答。
回答中应包含相关链接（如果有），保持回答简洁明了，直接针对用户问题。使用Markdown格式。`;

      contextText = optimizedContexts.map(ctx =>
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
            max_tokens: 1024,
            stream: false
          },
          {
            headers: {
              'Authorization': `Bearer ${SILICONE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 50000 // 20 second timeout for Netlify
          }
        );

        const completion = await withTimeout(apiPromise, 50000);

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

    // 9. Improve degraded replies based on question type
    if (question.toLowerCase().includes("什么是")) {
      const keyword = question.replace(/什么是|？|\?/g, '').trim();
      return `对不起，我目前无法生成详细回答。您询问的"${keyword}"是一个重要概念，我建议您查阅博客上的相关文章或稍后再试。

如果您想了解更多关于"${keyword}"的信息，可以尝试更具体的问题，例如"${keyword}的应用场景有哪些？"或"${keyword}与其他技术有什么区别？"`;
    } else {
      return `很抱歉，我无法处理您的请求"${question}"。这可能是由于服务器繁忙或连接问题。请稍后再试，或尝试提出更简短、更具体的问题。`;
    }
  }
}

// Safer file operations for Netlify environment
function safeFileOperation(operation, fallback) {
  try {
    return operation();
  } catch (error) {
    console.error('File operation failed:', error);
    return fallback;
  }
}

// Update store conversation function - use new API format
async function storeConversationInPinecone(question, answer, sessionId) {
  try {
    console.log("Attempting to store conversation in Pinecone...");

    // Skip Pinecone in development mode
    if (process.env.NODE_ENV === 'development' || !PINECONE_API_KEY) {
      console.log("Development mode or missing API key - skipping Pinecone, using local storage");
      return await storeConversationLocally(question, answer, sessionId);
    }

    // Rest of your Pinecone storage logic...
  } catch (error) {
    console.error("Error storing in Pinecone:", error);
    // Fall back to local storage
    await storeConversationLocally(question, answer, sessionId);
  }
}

// Local storage fallback
async function storeConversationLocally(question, answer, sessionId) {
  try {
    const conversationEntry = {
      id: crypto.randomUUID(),
      sessionId: sessionId,
      question: question,
      answer: answer,
      timestamp: new Date().toISOString()
    };

    // Netlify-compatible path
    const CONV_FILE = path.join(TEMP_STORAGE_DIR, 'conversations.json');

    let conversations = [];
    if (safeFileOperation(() => fs.existsSync(CONV_FILE), false)) {
      try {
        const data = safeFileOperation(() => fs.readFileSync(CONV_FILE, 'utf8'), '[]');
        conversations = JSON.parse(data);
      } catch (e) {
        // If parsing fails, use empty array
        conversations = [];
      }
    }

    conversations.push(conversationEntry);
    if (conversations.length > 100) {
      conversations = conversations.slice(-100);
    }

    safeFileOperation(() => {
      fs.writeFileSync(CONV_FILE, JSON.stringify(conversations));
    }, null);

    console.log("Conversation stored locally as fallback");
  } catch (error) {
    console.error("Failed to store conversation locally:", error);
  }
}

// Update session and request status helper function
function updateSessionWithAnswer(sessionId, requestId, question, answer) {
  try {
    console.log(`Updating session ${sessionId} with answer for request ${requestId}`);
    console.log(`Answer length: ${answer ? answer.length : 0}`);
    console.log(`Answer preview: ${answer ? answer.substring(0, 100) + "..." : "undefined"}`);


    // Get session history
    const session = sessionStore.getSession(sessionId) || {};
    const conversationHistory = session.history || [];

    // Update session history
    const updatedHistory = [...conversationHistory, {
      user: question,
      assistant: answer
    }];

    sessionStore.updateSession(sessionId, 'history', updatedHistory);

    // Update request status
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      status: 'completed',
      answer: answer,
      completed_at: Date.now()
    });

    console.log(`Session updated for request ${requestId}`);
  } catch (error) {
    console.error("Failed to update session:", error);
    // Try simplified update operation
    try {
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        status: 'completed',
        answer: answer,
        completed_at: Date.now()
      });
      console.log("Updated request status only");
    } catch (fallbackError) {
      console.error("Failed to update session even with fallback approach:", fallbackError);
    }
  }
}

// Process RAG request with Netlify timeout handling
async function processRagRequest(requestId, sessionId, question) {
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
    const session = sessionStore.getSession(sessionId) || {};
    const conversationHistory = session.history || [];

    // Check for simple greeting
    const normalizedQuestion = question.toLowerCase().trim();
    if (GREETING_CACHE[normalizedQuestion]) {
      console.log("Using cached greeting response");
      const answer = GREETING_CACHE[normalizedQuestion];

      // Update session and request status
      updateSessionWithAnswer(sessionId, requestId, question, answer);

      // Asynchronously store conversation to Pinecone (don't wait for completion)
      try {
        storeConversationInPinecone(question, answer, sessionId)
          .catch(error => console.error("Background conversation storage failed:", error));
      } catch (error) {
        console.error("Failed to initiate conversation storage:", error);
      }

      return answer;
    }

    // Periodic timeout check
    timeoutCheck();

    // Use Silicon Flow Qwen/QwQ-32B to evaluate if RAG is needed
    const needsRAG = await evaluateNeedForRAG(question, conversationHistory);

    let contexts = [];
    let answer = "";
    let queryEmbedding = null;

    try {
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
            console.log("Context retrieved, count:", contexts.length);
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

      // Generate answer using Silicon Flow Qwen/QwQ-32B
      answer = await generateAnswer(
        question,
        contexts,
        conversationHistory
      );
      console.log("Answer generated.");
    } catch (processingError) {
      console.error("Error during RAG process:", processingError);

      // If timeout is approaching, return a partial answer
      if (processingError.message === 'Function timeout approaching') {
        answer = `正在处理您的问题"${question}"，但由于问题复杂度较高，需要更多时间完成。请稍后再查询结果，或尝试更简单的问题。`;
      } else {
        // Generate an answer explaining the error
        answer = `对不起，在处理您的问题时遇到了技术困难。请稍后再试或重新表述您的问题。`;
      }
    }

    // Update session and request status
    updateSessionWithAnswer(sessionId, requestId, question, answer);

    // Asynchronously store conversation to Pinecone (don't wait for completion)
    try {
      storeConversationInPinecone(question, answer, sessionId)
        .catch(error => console.error("Background conversation storage failed:", error));
    } catch (storageError) {
      console.error("Error initiating conversation storage:", storageError);
    }

    console.log(`Request ${requestId} processing completed successfully.`);
    return answer;
  } catch (error) {
    console.error(`Error processing request ${requestId}:`, error);

    // Update request status to failed
    try {
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        status: 'failed',
        error: error.message,
        completed_at: Date.now()
      });
    } catch (sessionError) {
      console.error("Failed to update session with error:", sessionError);
    }

    // Return a failure message instead of throwing an error
    return `对不起，我无法处理这个请求。请稍后再试。`;
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
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

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

  try {
    console.log("RAG function called");
    console.log("HTTP Method:", event.httpMethod);

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
    const useStream = body.stream === true; // Check if streaming is requested

    // New: Check if fast response is preferred
    const preferFastResponse = body.preferFastResponse === true;

    console.log(`Question received: ${question}`);
    console.log(`Stream mode requested: ${useStream}`);

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
    if (!sessionId || !sessionStore.getSession(sessionId)) {
      sessionId = crypto.randomUUID();
      // 使用updateSession替代setSession
      if (typeof sessionStore.updateSession === 'function') {
        sessionStore.updateSession(sessionId, 'history', []);
        sessionStore.updateSession(sessionId, 'created_at', Date.now());
      } else {
        console.error("Warning: Unable to set session data, session_store.js lacks required methods");
      }
      console.log(`Created new session: ${sessionId}`);
    } else {
      console.log(`Using existing session: ${sessionId}`);
    }

    // Generate request ID
    const requestId = crypto.randomUUID();

    // Check if it's a simple greeting (fast path)
    const normalizedQuestion = question.toLowerCase().trim();
    if (GREETING_CACHE[normalizedQuestion]) {
      const answer = GREETING_CACHE[normalizedQuestion];

      // Update session and request status
      updateSessionWithAnswer(sessionId, requestId, question, answer);

      // Asynchronously store conversation (don't block response)
      Promise.resolve().then(() => {
        storeConversationInPinecone(question, answer, sessionId)
          .catch(error => console.error("Background conversation storage failed:", error));
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          answer: answer,
          sessionId: sessionId
        })
      };
    }

    // If streaming is requested
    if (useStream) {
      console.log("Stream mode requested, preparing streaming configuration");

      try {
        // Get session history
        const session = sessionStore.getSession(sessionId) || {};
        const conversationHistory = session.history || [];

        // Prepare streaming configuration for frontend
        // const streamConfig = {
        //   apiEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        //   apiKey: SILICONE_API_KEY,
        //   model: SILICON_REASONING_MODEL,
        //   messages: [
        //     { role: 'system', content: '你是一个友好的AI助手，擅长解释复杂概念。' },
        //     { role: 'user', content: question }
        //   ]
        // };

        const streamConfig = {
          apiEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
          apiKey: SILICONE_API_KEY,
          model: SILICON_REASONING_MODEL,
          messages: [
            { role: 'system', content: '你是一个友好的AI助手，擅长解释复杂概念，请使用中文回答以下问题。' },
            { role: 'user', content: question }
          ],
          parameters: {
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 0.9
          }
        };

        // Return a more complete response
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
            streamConfig: streamConfig,
            status: "streaming_prepared",
            timestamp: Date.now()
          })
        };

        // Initialize request status
        // sessionStore.updateSession(sessionId, 'current_request', {
        //   id: requestId,
        //   question: question,
        //   status: 'streaming',
        //   started_at: Date.now()
        // });

        // Return streaming configuration to frontend
        // return {
        //   statusCode: 200,
        //   headers: {
        //     'Content-Type': 'application/json',
        //     'Access-Control-Allow-Origin': '*',
        //     'Cache-Control': 'no-cache'
        //   },
        //   body: JSON.stringify({
        //     requestId: requestId,
        //     sessionId: sessionId,
        //     streamConfig: streamConfig,
        //     status: "streaming_prepared"
        //   })
        // };
      } catch (error) {
        console.error("Error setting up streaming:", error);
        return {
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            error: "Failed to setup streaming response",
            details: error.message
          })
        };
      }
    }

    // New: Question length and complexity analysis
    const isSimpleQuestion = question.length < 50 && !question.includes("如何") &&
                            !question.includes("为什么") && !question.includes("比较");

    // Check if fast response can be provided
    if (preferFastResponse || isSimpleQuestion) {
      // Provide a generic but relevant fast response
      let fastResponse;

      // Get session history for context
      const session = sessionStore.getSession(sessionId) || {};
      const conversationHistory = session.history || [];

      if (question.toLowerCase().includes("什么是")) {
        const keyword = question.replace(/什么是|？|\?/g, '').trim();
        fastResponse = `正在查询关于"${keyword}"的信息，请稍候...

我会尽快提供关于"${keyword}"的详细解释。您可以稍等片刻，或刷新页面查看完整回答。`;
      } else {
        fastResponse = `我正在处理您的问题"${question}"，请稍候...

我会尽快提供详细回答。您可以继续浏览其他内容，稍后回来查看完整回答。`;
      }

      // Initialize request status
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        question: question,
        status: 'processing',
        started_at: Date.now()
      });

      // Start async processing, don't wait for completion
      Promise.resolve().then(() => {
        processRagRequest(requestId, sessionId, question).catch(error => {
          console.error(`Background processing failed for request ${requestId}:`, error);
        });
      });

      // Return fast response
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
          quickResponse: fastResponse,
          message: "Full answer is being processed",
          status: "processing"
        })
      };
    }

    // For non-greeting queries, use normal processing flow
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      question: question,
      status: 'processing',
      started_at: Date.now()
    });

    console.log(`Created request ${requestId} in session ${sessionId}`);

    // Start processing but don't wait for completion (async mode)
    Promise.resolve().then(() => {
      processRagRequest(requestId, sessionId, question).catch(error => {
        console.error(`Background processing failed for request ${requestId}:`, error);
      });
    });

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