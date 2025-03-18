const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');
const sessionStore = require('../netlify/functions/shared-background/session_store.js');

// 环境变量配置
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT || 'gcp-starter';
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'blog-content';
const SILICONE_API_KEY = process.env.SILICONE_API_KEY || process.env.DEEPSEEK_API_KEY; // 兼容两种变量命名
const EMBEDDING_MODEL = 'Pro/BAAI/bge-m3';
const LLM_MODEL = 'Pro/deepseek-ai/DeepSeek-R1';

// Pinecone 客户端和索引
let pineconeIndex = null;
// 初始化 Pinecone 客户端
async function initPinecone() {
  try {
    if (!pineconeIndex) {
      console.log("Initializing Pinecone client...");
      const { Pinecone } = require('@pinecone-database/pinecone');
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
    const response = await axios.post(
      'https://api.siliconflow.cn/v1/embeddings',
      {
        model: EMBEDDING_MODEL,
        input: text
      },
      {
        headers: {
          'Authorization': `Bearer ${SILICONE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status !== 200) {
      throw new Error(`Error getting embedding: ${response.data}`);
    }

    return response.data.data[0].embedding;
  } catch (error) {
    console.error("Failed to get embedding:", error);
    throw error;
  }
}

// 检索相关上下文
async function retrieveContext(queryEmbedding, topK = 9) {
  try {
    console.log("Querying Pinecone with embedding...");
    const index = await initPinecone();

    const queryResponse = await index.query({
      vector: queryEmbedding,  // 改用 vector 而不是 queryVector
      topK: topK,
      includeMetadata: true
    });

    console.log(`Pinecone results: ${JSON.stringify(queryResponse)}`);

    // 提取上下文信息 - 可能需要根据新版本API调整
    const contexts = queryResponse.matches.map(match => ({
      content: match.metadata.content || '',
      url: match.metadata.url || '',
      title: match.metadata.title || '',
      score: match.score
    }));

    return contexts;
  } catch (error) {
    console.error("Failed to retrieve context:", error);
    throw error;
  }
}

// 生成回答
async function generateAnswer(question, contexts, conversationHistory = []) {
  try {
    console.log(`Generating answer for question: ${question.substring(0, 50)}...`);

    // 格式化上下文和对话历史
    const contextText = contexts.map(ctx =>
      `Title: ${ctx.title}\nURL: ${ctx.url}\nContent: ${ctx.content}`
    ).join('\n\n');

    const historyText = conversationHistory.map(item =>
      `User: ${item.user}\nAssistant: ${item.assistant}`
    ).join('\n');

    // 构建提示
    const systemPrompt = `You are a helpful assistant for a personal blog. Answer the user's questions based on the blog posts contents. 
If you cannot find the answer in the provided context, acknowledge that and provide your best general knowledge response.
Always include relevant links to blog posts when available in the context. Use markdown formatting in your responses.
Keep your answers concise and focused on the user's question.`;

    const prompt = `### Context from blog posts:
${contextText}

### Conversation History:
${historyText}

### Current Question:
${question}

Please provide a helpful response based on the context information.`;

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
        max_tokens: 5000
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

// 处理 RAG 请求
async function processRagRequest(requestId, sessionId, question) {
  try {
    console.log(`Processing request ${requestId} for session ${sessionId}`);

    // 获取问题的嵌入向量
    const queryEmbedding = await getEmbedding(question);
    console.log("Embedding obtained.");

    // 检索相关上下文
    const contexts = await retrieveContext(queryEmbedding);
    console.log("Context retrieved.");

    // 获取会话历史
    const session = sessionStore.getSession(sessionId) || {};
    const conversationHistory = session.history || [];

    // 生成回答
    const answer = await generateAnswer(
      question,
      contexts,
      conversationHistory
    );
    console.log("Answer generated.");

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

    console.log(`Request ${requestId} processing completed successfully.`);
    return answer;
  } catch (error) {
    console.error(`Error processing request ${requestId}:`, error);

    // 更新请求状态为失败
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      status: 'failed',
      error: error.message,
      completed_at: Date.now()
    });

    throw error;
  }
}

// 主处理函数
exports.handler = async (event, context) => {
  try {
    console.log("RAG function called");

    // 解析请求体
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

    // 生成请求ID
    const requestId = crypto.randomUUID();

    // 初始化请求状态
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      question: question,
      status: 'processing',
      started_at: Date.now()
    });

    console.log(`Created request ${requestId} in session ${sessionId}`);

    // 异步处理请求（在后台运行）
    processRagRequest(requestId, sessionId, question).catch(error => {
      console.error(`Background processing failed for request ${requestId}:`, error);
    });

    // 立即返回请求ID和会话ID用于客户端轮询
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
    await initPinecone();
    return { success: true };
  } catch (error) {
    console.error("Initialization failed:", error);
    return { success: false, error: error.message };
  }
};