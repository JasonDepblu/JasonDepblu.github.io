const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');
const sessionStore = require('../shared/session_store.js');

// 环境变量配置
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'blog-content';
const SILICONE_API_KEY = process.env.SILICONE_API_KEY || process.env.DEEPSEEK_API_KEY; // 兼容两种变量命名
const EMBEDDING_MODEL = 'Pro/BAAI/bge-m3';
const LLM_MODEL = 'Pro/deepseek-ai/DeepSeek-R1';
const LLM_MODEL2 = 'Qwen/Qwen2.5-14B-Instruct';

// 初始化 Pinecone 客户端
let pineconeIndex = null;

// 简单问候的缓存
const GREETING_CACHE = {
  "hi": "你好！我是博客助手，可以回答您关于博客内容的问题。有什么可以帮助您的吗？",
  "hello": "你好！有什么我可以帮助你的吗？",
  "hey": "嗨！有什么我可以帮助你的吗？",
  "你好": "你好！有什么我可以帮助你的吗？",
  "hello there": "你好！很高兴为您服务。请问有什么问题吗？",
  "嗨": "嗨！我是博客助手，很高兴能帮助您。",
  "哈喽": "哈喽！请问有什么可以帮助您的？"
};

// 快速预过滤，无需调用 LLM
function quickEvaluateNeedForRAG(question) {
  // 将问题转为小写并去除前后空格
  const normalizedQuestion = question.toLowerCase().trim();

  // 检查是否存在直接缓存匹配
  if (GREETING_CACHE[normalizedQuestion] !== undefined) {
    return false; // 不需要 RAG，使用缓存
  }

  // 简单问候模式
  const greetingPatterns = [
    /^(hi|hello|hey|howdy|greetings|哈喽|你好)(\s.*)?$/,
    /^(good\s)?(morning|afternoon|evening|day)(\s.*)?$/,
    /^how are you(\s.*)?$/,
    /^what'?s up(\s.*)?$/
  ];

  // 检查是否匹配任何问候模式
  for (const pattern of greetingPatterns) {
    if (pattern.test(normalizedQuestion)) {
      return false; // 不需要 RAG
    }
  }

  return null; // 未确定，需要进一步评估
}

async function initPinecone() {
  try {
    if (!pineconeIndex) {
      console.log("Initializing Pinecone client...");
      const pinecone = new Pinecone({
        apiKey: PINECONE_API_KEY
      });
      pineconeIndex = pinecone.index(PINECONE_INDEX_NAME);
      console.log("Pinecone client initialized.");
    }
    return pineconeIndex;
  } catch (error) {
    console.error("Failed to initialize Pinecone:", error);
    throw error;
  }
}

// 获取嵌入向量
async function getEmbedding(text) {
  try {
    console.log("Getting embedding for text...");

    // 检查 API 密钥是否有效
    if (!SILICONE_API_KEY || SILICONE_API_KEY.trim() === '') {
      console.error("Missing API key for embedding service");
      throw new Error("API key for embedding service is not configured");
    }

    console.log("API key status:", SILICONE_API_KEY ? "Key present" : "Key missing");

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SILICONE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text
      })
    };

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    options.signal = controller.signal;

    const response = await fetch('https://api.siliconflow.cn/v1/embeddings', options);
    clearTimeout(timeoutId); // 清除超时

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error getting embedding: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error("Failed to get embedding:", error);
    if (error.name === 'AbortError') {
      console.log("Embedding request timed out");
    }
    throw error;
  }
}

// 智能体评估是否需要RAG
async function evaluateNeedForRAG(question, conversationHistory) {
  try {
    // 先进行快速评估
    const quickResult = quickEvaluateNeedForRAG(question);
    if (quickResult !== null) {
      console.log(`Quick RAG evaluation: ${quickResult ? "NEED_RAG" : "NO_RAG"}`);
      return quickResult;
    }

    console.log("Evaluating if RAG is needed for the question...");

    // 构建提示以评估查询
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

    console.log("Evaluating using fetch API...");

    // 使用 fetch 替代 axios
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SILICONE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: LLM_MODEL2,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 10,
        stream: false
      })
    };

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时
    options.signal = controller.signal;

    try {
      const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', options);
      clearTimeout(timeoutId); // 清除超时

      console.log("Fetch response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("Fetch response received");

      const decision = data.choices[0].message.content.trim();
      console.log(`RAG decision: ${decision}`);

      return decision.includes("NEED_RAG");
    } catch (fetchError) {
      console.error("Fetch error:", fetchError.name, fetchError.message);
      if (fetchError.name === 'AbortError') {
        console.log("Fetch request timed out");
      }
      // 默认使用RAG
      return true;
    }
  } catch (error) {
    console.error("Failed to evaluate need for RAG:", error);
    // 默认使用RAG
    return true;
  }
}

// 从Pinecone检索上下文
async function retrieveContext(queryEmbedding, topK = 5) {
  try {
    console.log("Retrieving context from Pinecone...");

    // 必须有有效的嵌入向量
    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.error("Cannot retrieve context: embedding vector is empty");
      throw new Error("Invalid embedding vector");
    }

    // 初始化Pinecone客户端
    const index = await initPinecone();

    // 向Pinecone查询 - 修复查询格式
    try {
      // 尝试新版本API格式
      const queryResponse = await index.query({
        namespace: "",
        topK: topK,
        includeMetadata: true,
        vector: queryEmbedding  // 确保提供vector参数
      });

      // 处理查询结果
      if (!queryResponse.matches || queryResponse.matches.length === 0) {
        console.log("No matching documents found in Pinecone");
        return [];
      }

      console.log(`Found ${queryResponse.matches.length} matches in Pinecone`);

      // 转换匹配结果为上下文格式
      const contexts = queryResponse.matches.map(match => ({
        content: match.metadata?.content || '',
        url: match.metadata?.url || '',
        title: match.metadata?.title || '',
        score: match.score || 0
      }));

      return contexts;
    } catch (error) {
      // 如果新版本API格式失败，尝试旧版本格式
      console.log("Trying alternative Pinecone query format...");
      const altQueryResponse = await index.query({
        queries: [{
          values: queryEmbedding,
          topK: topK,
          includeMetadata: true
        }]
      });

      const matches = altQueryResponse.results?.[0]?.matches || [];
      if (matches.length === 0) {
        console.log("No matching documents found in Pinecone (alt method)");
        return [];
      }

      console.log(`Found ${matches.length} matches in Pinecone (alt method)`);

      // 转换匹配结果为上下文格式
      const contexts = matches.map(match => ({
        content: match.metadata?.content || '',
        url: match.metadata?.url || '',
        title: match.metadata?.title || '',
        score: match.score || 0
      }));

      return contexts;
    }
  } catch (error) {
    console.error("Failed to retrieve context from Pinecone:", error);
    // 返回空数组而不是抛出错误，确保用户仍能获得回复
    return [];
  }
}

// 生成回答
async function generateAnswer(question, contexts, conversationHistory = []) {
  try {
    console.log(`Generating answer for question: ${question.substring(0, 50)}...`);

    // 根据上下文是否为空调整系统提示
    let systemPrompt;
    let contextText = "";

    if (contexts && contexts.length > 0) {
      systemPrompt = `你是一个博客助手，根据提供的博客文章内容回答用户问题。如果提供的上下文中没有答案，请说明并给出你的最佳回答。
回答中应包含相关链接（如果有），并使用Markdown格式。保持回答简洁明了，直接针对用户问题。`;

      contextText = contexts.map(ctx =>
        `标题: ${ctx.title}\n链接: ${ctx.url}\n内容: ${ctx.content}`
      ).join('\n\n');
    } else {
      systemPrompt = `你是一个友好的助手，尽力回答用户的问题。
使用Markdown格式，保持回答简洁明了，直接针对用户问题。`;
    }

    // 格式化对话历史
    const historyText = conversationHistory.map(item =>
      `用户: ${item.user}\n助手: ${item.assistant}`
    ).join('\n\n');

    // 构建提示
    let prompt;
    if (contextText) {
      prompt = `### 博客文章内容:
${contextText}

### 对话历史:
${historyText}

### 当前问题:
${question}

请根据提供的博客内容回答问题。`;
    } else {
      prompt = `### 对话历史:
${historyText}

### 当前问题:
${question}

请回答问题。`;
    }

    // 调用 Silicone Flow API
    const response = await axios.post(
      'https://api.siliconflow.cn/v1/chat/completions',
      {
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${SILICONE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status !== 200) {
      throw new Error(`Error generating answer: ${response.data}`);
    }

    const responseContent = response.data.choices[0].message.content;
    console.log(`Answer generated successfully.`);

    return responseContent;
  } catch (error) {
    console.error("Failed to generate answer:", error);
    throw error;
  }
}

// 将对话存储到Pinecone
async function storeConversationInPinecone(question, answer, sessionId) {
  try {
    console.log("Storing conversation in Pinecone...");

    // 生成对话的嵌入向量
    const conversationText = `问题: ${question}\n回答: ${answer}`;
    const embedding = await getEmbedding(conversationText);

    if (!embedding || embedding.length === 0) {
      console.log("Skip storing conversation due to embedding failure");
      return;
    }

    // 初始化Pinecone
    const index = await initPinecone();

    // 创建要存储的对象
    const timestamp = new Date().toISOString();
    const id = `conv_${sessionId}_${timestamp}_${crypto.randomUUID().substring(0, 8)}`;

    const vectorData = {
      id: id,
      values: embedding,
      metadata: {
        content: conversationText,
        title: `对话片段: ${question.substring(0, 30)}...`,
        url: `/conversations/${sessionId}`,
        type: 'conversation',
        timestamp: timestamp,
        sessionId: sessionId
      }
    };

    // 尝试将向量上传到Pinecone
    try {
      // 使用正确的API格式
      await index.upsert([vectorData]);
      console.log(`Conversation stored in Pinecone with ID: ${id}`);
    } catch (error) {
      // 如果第一种方法失败，尝试替代方法
      try {
        await index.upsert({
          vectors: [vectorData]
        });
        console.log(`Conversation stored in Pinecone with ID (alt method): ${id}`);
      } catch (altError) {
        console.error("Failed to store conversation in Pinecone:", altError);
        // 继续执行，不要因为存储失败阻止主要功能
      }
    }
  } catch (error) {
    console.error("Error in storing conversation:", error);
    // 继续执行，不阻止主流程
  }
}

// 更新会话和请求状态的辅助函数
function updateSessionWithAnswer(sessionId, requestId, question, answer) {
  // 获取会话历史
  const session = sessionStore.getSession(sessionId) || {};
  const conversationHistory = session.history || [];

  // 更新会话历史
  const updatedHistory = [...conversationHistory, {
    user: question,
    assistant: answer
  }];

  sessionStore.updateSession(sessionId, 'history', updatedHistory);

  // 更新请求状态
  sessionStore.updateSession(sessionId, 'current_request', {
    id: requestId,
    status: 'completed',
    answer: answer,
    completed_at: Date.now()
  });

  console.log(`Session updated for request ${requestId}`);
}

// 处理 RAG 请求
async function processRagRequest(requestId, sessionId, question) {
  try {
    console.log(`Processing request ${requestId} for session ${sessionId}`);

    // 获取会话历史
    const session = sessionStore.getSession(sessionId) || {};
    const conversationHistory = session.history || [];

    // 检查是否是简单问候
    const normalizedQuestion = question.toLowerCase().trim();
    if (GREETING_CACHE[normalizedQuestion]) {
      console.log("Using cached greeting response");
      const answer = GREETING_CACHE[normalizedQuestion];

      // 更新会话和请求状态
      updateSessionWithAnswer(sessionId, requestId, question, answer);

      // 异步存储对话到Pinecone（不等待完成）
      setTimeout(() => {
        storeConversationInPinecone(question, answer, sessionId)
          .catch(error => console.error("Background conversation storage failed:", error));
      }, 10);

      return answer;
    }

    // 使用智能体评估是否需要RAG
    const needsRAG = await evaluateNeedForRAG(question, conversationHistory);

    let contexts = [];
    let answer = "";
    let queryEmbedding = null;

    try {
      if (needsRAG) {
        // 获取问题的嵌入向量
        try {
          queryEmbedding = await getEmbedding(question);
          console.log("Embedding obtained, length:", queryEmbedding?.length || 0);
        } catch (embeddingError) {
          console.error("Error getting embedding:", embeddingError);
          queryEmbedding = null;
        }

        // 检索相关上下文
        if (queryEmbedding && queryEmbedding.length > 0) {
          try {
            contexts = await retrieveContext(queryEmbedding);
            console.log("Context retrieved, count:", contexts.length);
          } catch (contextError) {
            console.error("Error retrieving context:", contextError);
            contexts = []; // 确保上下文是空数组而不是undefined
          }
        }
      } else {
        console.log("Skipping RAG based on question evaluation");
      }

      // 生成回答
      answer = await generateAnswer(
        question,
        contexts,
        conversationHistory
      );
      console.log("Answer generated.");
    } catch (error) {
      console.error("Error during RAG process:", error);
      // 生成一个错误解释的回答
      answer = `对不起，在处理您的问题时遇到了技术困难。请稍后再试或重新表述您的问题。`;
    }

    // 更新会话和请求状态
    updateSessionWithAnswer(sessionId, requestId, question, answer);

    // 异步存储对话到Pinecone（不等待完成）
    try {
      storeConversationInPinecone(question, answer, sessionId).catch(error => {
        console.error("Background conversation storage failed:", error);
      });
    } catch (storageError) {
      console.error("Error initiating conversation storage:", storageError);
    }

    console.log(`Request ${requestId} processing completed successfully.`);
    return answer;
  } catch (error) {
    console.error(`Error processing request ${requestId}:`, error);

    // 更新请求状态为失败
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

    // 返回一个失败消息而不是抛出错误
    return `对不起，我无法处理这个请求。请稍后再试。`;
  }
}

// 预热连接
async function warmupConnections() {
  try {
    console.log("Pre-warming API connections...");
    await Promise.all([
      initPinecone(),
      getEmbedding("warmup query").catch(() => console.log("Embedding API warmup completed with error (continuing)")),
    ]);
    console.log("API connections pre-warmed");
  } catch (error) {
    console.error("Connection warmup failed (continuing):", error);
  }
}

// 响应队列管理
class ResponseQueue {
  constructor() {
    this.greetingQueue = [];  // 优先队列
    this.complexQueue = [];   // 复杂查询队列
    this.processing = false;
  }

  addQuery(requestId, sessionId, question, isGreeting) {
    const queue = isGreeting ? this.greetingQueue : this.complexQueue;
    queue.push({ requestId, sessionId, question });
    this.processNext();
  }

  async processNext() {
    if (this.processing) return;

    this.processing = true;
    try {
      // 优先处理问候
      const nextItem = this.greetingQueue.shift() || this.complexQueue.shift();
      if (nextItem) {
        await processRagRequest(nextItem.requestId, nextItem.sessionId, nextItem.question);
      }
    } finally {
      this.processing = false;
      if (this.greetingQueue.length || this.complexQueue.length) {
        setImmediate(() => this.processNext());
      }
    }
  }
}

const responseQueue = new ResponseQueue();

// 主处理函数
exports.handler = async (event, context) => {
  try {
    console.log("RAG function called");

    const body = JSON.parse(event.body || '{}');
    const question = body.question || '';
    let sessionId = body.sessionId;

    console.log(`Question received: ${question}`);

    // 创建或获取会话
    if (!sessionId || !sessionStore.getSession(sessionId)) {
      sessionId = crypto.randomUUID();
      sessionStore.setSession(sessionId, {
        history: [],
        created_at: Date.now()
      });
      console.log(`Created new session: ${sessionId}`);
    } else {
      console.log(`Using existing session: ${sessionId}`);
    }

    // 生成请求ID - 移到这里，确保在所有分支都能访问
    const requestId = crypto.randomUUID();

    // 检查是否是简单问候（快速路径）
    const normalizedQuestion = question.toLowerCase().trim();
    if (GREETING_CACHE[normalizedQuestion]) {
      const answer = GREETING_CACHE[normalizedQuestion];

      // 更新会话和请求状态
      updateSessionWithAnswer(sessionId, requestId, question, answer);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          answer: answer,
          sessionId: sessionId
        })
      };
    }

    // 对于复杂查询，使用异步处理模式
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      question: question,
      status: 'processing',
      started_at: Date.now()
    });

    console.log(`Created request ${requestId} in session ${sessionId}`);

    // 异步处理请求
    processRagRequest(requestId, sessionId, question).catch(error => {
      console.error(`Background processing failed for request ${requestId}:`, error);
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        requestId: requestId,
        sessionId: sessionId,
        message: "Request is being processed"
      })
    };
  } catch (error) {
    console.error("Error in handler:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

// 用于预初始化的处理
exports.init = async () => {
  try {
    // 预热连接
    await warmupConnections();
    return { success: true };
  } catch (error) {
    console.error("Initialization failed:", error);
    return { success: false, error: error.message };
  }
};