const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios'); // 保留axios用于硅基流动API
const { OpenAI } = require('openai'); // 用于DeepSeek API
const { Pinecone } = require('@pinecone-database/pinecone');
const sessionStore = require('../shared-background/session_store.js');

// 环境变量配置
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'blog-content';
const SILICONE_API_KEY = process.env.SILICONE_API_KEY; // 硅基流动API密钥
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY; // DeepSeek API密钥

// 初始化DeepSeek API客户端
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: DEEPSEEK_API_KEY
});

// 模型名称配置
const EMBEDDING_MODEL = 'Pro/BAAI/bge-m3'; // 硅基流动嵌入模型
const DEEPSEEK_CHAT_MODEL = 'deepseek-chat'; // 用于RAG判断
const DEEPSEEK_REASONER_MODEL = 'deepseek-reasoner'; // 用于回答生成

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

// 更新 Pinecone 初始化函数 - 基于最新官方示例
// 更新 Pinecone 初始化函数 - 确保提供 environment 参数
async function initPinecone() {
  try {
    if (!pineconeIndex) {
      console.log("Initializing Pinecone client...");

      // 检查环境变量
      if (!PINECONE_API_KEY) {
        throw new Error("Missing Pinecone API key");
      }

      // 确保有 environment 参数
      const environment = process.env.PINECONE_ENVIRONMENT;
      if (!environment) {
        console.error("Missing PINECONE_ENVIRONMENT variable");
        throw new Error("Pinecone environment must be specified");
      }

      const indexName = PINECONE_INDEX_NAME || 'blog-content';

      console.log(`Pinecone environment: ${environment}`);
      console.log(`Pinecone index name: ${indexName}`);

      // 使用必要的 environment 参数初始化
      const pinecone = new Pinecone({
        apiKey: PINECONE_API_KEY,
        environment: environment  // 这是必需的参数
      });

      // 创建索引实例
      pineconeIndex = pinecone.index(indexName);
      console.log("Pinecone client initialized successfully");
    }

    return pineconeIndex;
  } catch (error) {
    console.error("Failed to initialize Pinecone:", error);
    throw error;
  }
}

// 使用硅基流动API获取嵌入向量
// 替换原有的嵌入向量获取函数
// 移除 fetch API 使用，完全使用 axios
async function getEmbedding(text) {
  try {
    console.log("Getting embedding for text using Silicon Flow API...");

    // 检查 API 密钥是否有效
    if (!SILICONE_API_KEY || SILICONE_API_KEY.trim() === '') {
      console.error("Missing API key for Silicon Flow embedding service");
      throw new Error("Silicon Flow API key is not configured");
    }

    console.log("Silicon Flow API key status-background:", SILICONE_API_KEY ? "Key present" : "Key missing");

    // 使用 axios 发送请求
    try {
      const response = await axios.post(
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
          timeout: 60000 // 60秒超时
        }
      );

      if (response.status !== 200) {
        throw new Error(`Error getting embedding: ${JSON.stringify(response.data)}`);
      }

      console.log("Successfully generated embedding with axios");
      return response.data.data[0].embedding;
    } catch (axiosError) {
      console.error("Failed to get embedding with axios:", axiosError.message);

      // 如果是超时错误，提供更明确的错误信息
      if (axiosError.code === 'ECONNABORTED') {
        throw new Error("Embedding request timed out after 60 seconds");
      }

      // 如果响应中包含详细错误信息，则提取
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

// 使用DeepSeek API评估是否需要RAG
async function evaluateNeedForRAG(question, conversationHistory) {
  try {
    // 先进行快速评估
    const quickResult = quickEvaluateNeedForRAG(question);
    if (quickResult !== null) {
      console.log(`Quick RAG evaluation: ${quickResult ? "NEED_RAG" : "NO_RAG"}`);
      return quickResult;
    }

    console.log("Evaluating if RAG is needed using DeepSeek Chat...");

    // 检查 API 密钥是否有效
    if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY.trim() === '') {
      console.error("Missing API key for DeepSeek service");
      throw new Error("DeepSeek API key is not configured");
    }

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

    try {
      // 使用DeepSeek Chat API评估
      console.log("Using DeepSeek Chat API for evaluation...");
      const completion = await openai.chat.completions.create({
        model: DEEPSEEK_CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 50
      });

      console.log("Using DeepSeek Chat API for evaluation...");

      const decision = completion.choices[0].message.content.trim();
      console.log(`RAG decision (DeepSeek): ${decision}`);

      return decision.includes("NEED_RAG");
    } catch (error) {
      console.error("DeepSeek API evaluation failed:", error.message);
      return true; // 默认使用RAG
    }
  } catch (error) {
    console.error("Failed to evaluate need for RAG:", error);
    // 默认使用RAG
    return true;
  }
}

// 从Pinecone检索上下文
async function retrieveContext(queryEmbedding, topK = 3) {
  try {
    console.log("Retrieving context from Pinecone...");

    // 必须有有效的嵌入向量
    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.error("Cannot retrieve context: embedding vector is empty");
      throw new Error("Invalid embedding vector");
    }

    // 初始化Pinecone客户端
    const index = await initPinecone();

    // 向Pinecone查询 - 尝试多种方法
    try {
      // 尝试新版本API格式
      console.log("Trying Pinecone query with new API format");
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
    } catch (newApiError) {
      console.log("New API format failed:", newApiError.message);
      console.log("Trying alternative Pinecone query format...");

      try {
        // 尝试旧版本格式
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
      } catch (oldApiError) {
        console.log("Alternative query format also failed:", oldApiError.message);
        console.log("Trying third query format...");

        try {
          // 尝试第三种格式
          const thirdQueryResponse = await index.query({
            vector: queryEmbedding,
            topK: topK,
            includeMetadata: true
          });

          const thirdMatches = thirdQueryResponse.matches || [];
          if (thirdMatches.length === 0) {
            console.log("No matching documents found in Pinecone (third method)");
            return [];
          }

          console.log(`Found ${thirdMatches.length} matches in Pinecone (third method)`);

          // 转换匹配结果为上下文格式
          const contexts = thirdMatches.map(match => ({
            content: match.metadata?.content || '',
            url: match.metadata?.url || '',
            title: match.metadata?.title || '',
            score: match.score || 0
          }));

          return contexts;
        } catch (thirdApiError) {
          console.error("All Pinecone query formats failed");
          return []; // 返回空数组，不中断流程
        }
      }
    }
  } catch (error) {
    console.error("Failed to retrieve context from Pinecone:", error);
    // 返回空数组而不是抛出错误，确保用户仍能获得回复
    return [];
  }
}

// 添加通用重试函数
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries}...`);
      return await operation();
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      lastError = error;

      // 最后一次尝试失败就不再等待
      if (attempt < maxRetries) {
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // 增加延迟时间，退避策略
        delay = delay * 1.5;
      }
    }
  }

  throw lastError;
}

// 使用DeepSeek Reasoner生成回答
async function generateAnswer(question, contexts, conversationHistory = []) {
  try {
    console.log(`Generating answer for question using DeepSeek Reasoner: ${question.substring(0, 50)}...`);

    // 检查 API 密钥是否有效
    if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY.trim() === '') {
      console.error("Missing API key for DeepSeek service");
      throw new Error("DeepSeek API key is not configured");
    }

    // 1. 优化上下文 - 限制数量和长度
    let optimizedContexts = [];
    if (contexts && contexts.length > 0) {
      // 仅取前3个最相关上下文
      optimizedContexts = contexts.slice(0, 3).map(ctx => ({
        title: ctx.title,
        url: ctx.url,
        // 限制每个上下文内容长度为600字符
        content: ctx.content?.length > 600 ? ctx.content.substring(0, 600) + "..." : ctx.content || ""
      }));
    }

    // 2. 优化对话历史 - 仅保留最近3轮对话且限制长度
    const recentHistory = conversationHistory.slice(-3).map(item => ({
      user: item.user,
      // 限制每个回复长度为200字符
      assistant: item.assistant?.length > 200 ?
        item.assistant.substring(0, 200) + "..." :
        item.assistant || ""
    }));

    // 3. 构建系统提示
    let systemPrompt;
    let contextText = "";

    if (optimizedContexts.length > 0) {
      systemPrompt = `你是一个博客助手，根据提供的博客文章内容回答用户问题。如果提供的上下文中没有答案，请说明并给出你的最佳回答。
回答中应包含相关链接（如果有），保持回答简洁明了，直接针对用户问题。使用Markdown格式。`;

      contextText = optimizedContexts.map(ctx =>
        `标题: ${ctx.title}\n链接: ${ctx.url}\n内容: ${ctx.content}`
      ).join('\n\n');
    } else {
      systemPrompt = `你是一个友好的助手，尽力回答用户的问题。
使用Markdown格式，保持回答简洁明了，直接针对用户问题。`;
    }

    // 4. 格式化对话历史 - 精简
    const historyText = recentHistory.length > 0 ?
      recentHistory.map(item => `用户: ${item.user}\n助手: ${item.assistant}`).join('\n\n') :
      "";

    // 5. 构建提示 - 根据情况精简
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

    // 6. 构建消息数组
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // 记录请求大小
    const requestSize = JSON.stringify(messages).length;
    console.log(`Request size: ${requestSize} characters`);
    if (requestSize > 8000) {
      console.warn("Warning: Request size is very large, may cause issues");
    }

    // 7. 使用重试逻辑调用DeepSeek Reasoner API
    try {
      const answer = await retryOperation(async () => {
        console.log("Calling DeepSeek Reasoner API...");
        const completion = await openai.chat.completions.create({
          model: DEEPSEEK_REASONER_MODEL,
          messages: messages,
          temperature: 0.6,
          max_tokens: 1024
        });

        const responseContent = completion.choices[0].message.content;
        console.log("Answer generated successfully with DeepSeek Reasoner");
        return responseContent;
      }, 2, 2000); // 最多2次重试，初始延迟2秒

      return answer;
    } catch (error) {
      console.error("Failed to generate answer with DeepSeek Reasoner:", error);
      throw new Error("Failed to generate answer with DeepSeek Reasoner");
    }
  } catch (error) {
    console.error("Failed to generate answer:", error);

    // 9. 改进降级回复，根据问题类型提供更有帮助的回复
    if (question.toLowerCase().includes("什么是")) {
      const keyword = question.replace(/什么是|？|\?/g, '').trim();
      return `对不起，我目前无法生成详细回答。您询问的"${keyword}"是一个重要概念，我建议您查阅博客上的相关文章或稍后再试。

如果您想了解更多关于"${keyword}"的信息，可以尝试更具体的问题，例如"${keyword}的应用场景有哪些？"或"${keyword}与其他技术有什么区别？"`;
    } else {
      return `很抱歉，我无法处理您的请求"${question}"。这可能是由于服务器繁忙或连接问题。请稍后再试，或尝试提出更简短、更具体的问题。`;
    }
  }
}

// 更新存储对话函数 - 使用新的 API 格式
async function storeConversationInPinecone(question, answer, sessionId) {
  try {
    console.log("Storing conversation in Pinecone...");

    // 如果未配置Pinecone API密钥，跳过存储
    if (!PINECONE_API_KEY) {
      console.log("Skipping conversation storage: Pinecone API key not configured");
      return;
    }

    // 初始化Pinecone
    let index;
    try {
      index = await initPinecone();
      if (!index) {
        throw new Error("Failed to initialize Pinecone index");
      }
    } catch (pineconeError) {
      console.error("Unable to initialize Pinecone:", pineconeError);
      return;
    }

    // 创建命名空间实例 - 使用默认命名空间或空字符串
    const namespace = index.namespace("");
    console.log("Using Pinecone namespace: default (empty string)");

    // 生成ID
    const timestamp = new Date().toISOString();
    const recordId = `conv_${sessionId}_${timestamp}_${crypto.randomUUID().substring(0, 8)}`;

    // 准备要upsert的记录
    const record = {
      _id: recordId,
      chunk_text: `问题: ${question}\n回答: ${answer}`,
      metadata: {
        type: 'conversation',
        timestamp: timestamp,
        sessionId: sessionId,
        url: `/conversations/${sessionId}`
      }
    };

    // 尝试upsert操作
    try {
      console.log("Upserting record to Pinecone...");
      await namespace.upsertRecords([record]);
      console.log(`Conversation successfully stored in Pinecone with ID: ${recordId}`);
    } catch (upsertError) {
      console.error("Failed to upsert to Pinecone:", upsertError);

      // 如果失败，尝试直接使用index而不是namespace
      try {
        console.log("Trying direct index upsertRecords...");
        await index.upsertRecords([record]);
        console.log(`Conversation stored using direct index upsert, ID: ${recordId}`);
      } catch (directError) {
        console.error("Direct index upsert also failed:", directError);

        // 如果所有尝试都失败，可以考虑本地存储作为备选
        await storeConversationLocally(question, answer, sessionId);
      }
    }
  } catch (error) {
    console.error("Error in storing conversation:", error);
    // 继续执行，不阻止主流程
  }
}

// 本地存储备选方案
async function storeConversationLocally(question, answer, sessionId) {
  try {
    const conversationEntry = {
      id: crypto.randomUUID(),
      sessionId: sessionId,
      question: question,
      answer: answer,
      timestamp: new Date().toISOString()
    };

    const CONV_FILE = path.join('/tmp', 'conversations.json');

    let conversations = [];
    if (fs.existsSync(CONV_FILE)) {
      try {
        const data = fs.readFileSync(CONV_FILE, 'utf8');
        conversations = JSON.parse(data);
      } catch (e) {
        // 如果解析失败，使用空数组
      }
    }

    conversations.push(conversationEntry);
    if (conversations.length > 100) {
      conversations = conversations.slice(-100);
    }

    fs.writeFileSync(CONV_FILE, JSON.stringify(conversations));
    console.log("Conversation stored locally as fallback");
  } catch (error) {
    console.error("Failed to store conversation locally:", error);
  }
}

// 更新会话和请求状态的辅助函数
function updateSessionWithAnswer(sessionId, requestId, question, answer) {
  try {
    console.log(`Updating session ${sessionId} with answer for request ${requestId}`);

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
  } catch (error) {
    console.error("Failed to update session:", error);
    // 尝试简化更新操作
    try {
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        status: 'completed',
        answer: answer,
        completed_at: Date.now()
      });
      console.log("Updated request status-background only");
    } catch (fallbackError) {
      console.error("Failed to update session even with fallback approach:", fallbackError);
    }
  }
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
      try {
        storeConversationInPinecone(question, answer, sessionId)
          .catch(error => console.error("Background conversation storage failed:", error));
      } catch (error) {
        console.error("Failed to initiate conversation storage:", error);
      }

      return answer;
    }

    // 使用DeepSeek Chat评估是否需要RAG
    const needsRAG = await evaluateNeedForRAG(question, conversationHistory);

    let contexts = [];
    let answer = "";
    let queryEmbedding = null;

    try {
      // 如果需要RAG过程
      if (needsRAG) {
        console.log("RAG is needed for this question");

        // 获取问题的嵌入向量 (使用硅基流动API)
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

      // 使用DeepSeek Reasoner生成回答
      answer = await generateAnswer(
        question,
        contexts,
        conversationHistory
      );
      console.log("Answer generated.");
    } catch (processingError) {
      console.error("Error during RAG process:", processingError);
      // 生成一个错误解释的回答
      answer = `对不起，在处理您的问题时遇到了技术困难。请稍后再试或重新表述您的问题。`;
    }

    // 更新会话和请求状态
    updateSessionWithAnswer(sessionId, requestId, question, answer);

    // 异步存储对话到Pinecone（不等待完成）
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
    await Promise.allSettled([
      initPinecone().catch(err => console.log("Pinecone warmup completed with error:", err.message)),
      getEmbedding("warmup query").catch(err => console.log("Embedding API warmup completed with error:", err.message)),
      // 检查DeepSeek API连接
      openai.chat.completions.create({
        model: DEEPSEEK_CHAT_MODEL,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      }).catch(err => console.log("DeepSeek API warmup completed with error:", err.message))
    ]);
    console.log("API connections pre-warmed");
    return true;
  } catch (error) {
    console.error("Connection warmup failed (continuing):", error);
    return false;
  }
}

// 修改后的主处理函数
exports.handler = async (event, context) => {
  // 增加对 OPTIONS 请求的处理
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

  // 仅接受POST请求
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

    // 解析请求体
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

    // 新增: 检查是否是简单问题标志
    const preferFastResponse = body.preferFastResponse === true;

    console.log(`Question received: ${question}`);

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

    // 检查是否是简单问候（快速路径）
    const normalizedQuestion = question.toLowerCase().trim();
    if (GREETING_CACHE[normalizedQuestion]) {
      const answer = GREETING_CACHE[normalizedQuestion];

      // 更新会话和请求状态
      updateSessionWithAnswer(sessionId, requestId, question, answer);

      // 异步存储对话（不阻塞响应）
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

    // 新增: 问题长度和复杂度分析
    const isSimpleQuestion = question.length < 50 && !question.includes("如何") &&
                            !question.includes("为什么") && !question.includes("比较");

    // 检查是否可以快速响应
    if (preferFastResponse || isSimpleQuestion) {
      // 提供一个通用但相关的快速响应
      let fastResponse;

      // 获取会话历史用于确定上下文
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

      // 初始化请求状态
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        question: question,
        status: 'processing',
        started_at: Date.now()
      });

      // 启动异步处理，不等待完成
      Promise.resolve().then(() => {
        processRagRequest(requestId, sessionId, question).catch(error => {
          console.error(`Background processing failed for request ${requestId}:`, error);
        });
      });

      // 返回快速响应
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

    // 对于非问候查询，使用正常的处理流程
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      question: question,
      status: 'processing',
      started_at: Date.now()
    });

    console.log(`Created request ${requestId} in session ${sessionId}`);

    // 启动处理但不等待完成 (异步模式)
    Promise.resolve().then(() => {
      processRagRequest(requestId, sessionId, question).catch(error => {
        console.error(`Background processing failed for request ${requestId}:`, error);
      });
    });

    // 返回请求ID用于客户端轮询
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

// 用于预初始化的处理
exports.init = async () => {
  try {
    // 预热连接
    const warmupSuccess = await warmupConnections();
    return { success: warmupSuccess };
  } catch (error) {
    console.error("Initialization failed:", error);
    return { success: false, error: error.message };
  }
};