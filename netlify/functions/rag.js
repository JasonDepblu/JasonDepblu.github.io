import fetch from 'node-fetch';
import { Pinecone } from '@pinecone-database/pinecone';

// 内存存储 - 用于存储请求状态和结果
// 注意：这只在函数实例存活期间有效，Netlify函数冷启动后会重置
global.requestStorage = global.requestStorage || {};

// 配置参数
const CONFIG = {
  FETCH_TIMEOUT: 8000,          // 8秒API调用超时
  PINECONE_TIMEOUT: 6000,       // 6秒Pinecone操作超时
  RETRY_COUNT: 1,                // 重试次数
  RETRY_DELAY: 500,              // 初始重试延迟(毫秒)
  STORAGE_EXPIRY: 10 * 60 * 1000, // 存储数据10分钟后过期
};

// 存储函数 - 将数据保存到内存中
function saveToStorage(requestId, data) {
  // 添加过期时间
  const expiry = Date.now() + CONFIG.STORAGE_EXPIRY;
  global.requestStorage[requestId] = {
    ...data,
    expiry
  };
  
  console.log(`已保存请求数据，ID: ${requestId}，状态: ${data.status}`);
  return true;
}

// 获取函数 - 从内存中获取数据
function getFromStorage(requestId) {
  // 清理过期数据
  cleanExpiredStorage();
  
  // 获取数据
  return global.requestStorage[requestId] || null;
}

// 清理过期数据
function cleanExpiredStorage() {
  const now = Date.now();
  let cleanCount = 0;
  
  for (const requestId in global.requestStorage) {
    if (global.requestStorage[requestId].expiry < now) {
      delete global.requestStorage[requestId];
      cleanCount++;
    }
  }
  
  if (cleanCount > 0) {
    console.log(`已清理 ${cleanCount} 条过期数据`);
  }
}

// 帮助函数：给Promise添加超时
const withTimeout = (promise, timeoutMs, operationName) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${operationName} operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

// 帮助函数：添加重试机制
const withRetry = async (operation, maxRetries, initialDelay, operationName) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.warn(`${operationName} attempt ${attempt + 1}/${maxRetries + 1} failed:`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        // 指数退避策略
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};

// Pinecone客户端缓存
let pineconeIndex = null;
let pineconeClient = null;

// 初始化Pinecone
async function initPinecone() {
  if (pineconeIndex) return pineconeIndex;
  
  return withRetry(async () => {
    try {
      console.log("正在初始化 Pinecone...");
      console.log(`API Key: ${process.env.PINECONE_API_KEY ? "已设置" : "未设置"}`);
      console.log(`索引名称: ${process.env.PINECONE_INDEX}`);

      // 创建Pinecone客户端
      pineconeClient = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
      });

      console.log("Pinecone 客户端创建成功");

      // 获取索引实例
      pineconeIndex = await withTimeout(
        pineconeClient.index(process.env.PINECONE_INDEX),
        CONFIG.PINECONE_TIMEOUT,
        "Pinecone初始化"
      );
      
      console.log("Pinecone 索引初始化成功");
      return pineconeIndex;
    } catch (err) {
      console.error("初始化 Pinecone 出错:", err);
      throw err;
    }
  }, CONFIG.RETRY_COUNT, CONFIG.RETRY_DELAY, "Pinecone初始化");
}

// 安全查询函数
async function safeQuery(vector, topK = 5, includeMetadata = true) {
  return withRetry(async () => {
    try {
      const idx = await initPinecone();

      // 确保向量是数组
      if (!Array.isArray(vector)) {
        console.error("向量不是数组格式:", typeof vector);
        throw new Error("查询向量必须是数组");
      }

      console.log("准备查询 Pinecone...");
      console.log(`向量维度: ${vector.length}`);
      console.log("向量前5个元素示例:", vector.slice(0, 5));

      // 执行查询
      const queryResponse = await withTimeout(
        idx.query({
          vector: vector,
          topK: topK,
          includeMetadata: includeMetadata,
        }),
        CONFIG.PINECONE_TIMEOUT,
        "Pinecone查询"
      );

      return queryResponse;
    } catch (error) {
      console.error("Pinecone 查询失败:", error);
      // 失败时返回空匹配结果
      return { matches: [] };
    }
  }, CONFIG.RETRY_COUNT, CONFIG.RETRY_DELAY, "Pinecone查询");
}

// 文本嵌入函数
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
        "嵌入向量生成"
      );

      if (!response.ok) {
        throw new Error(`嵌入API请求失败: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("嵌入API响应成功");
      
      // 提取向量数据
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

      // 确保向量是数组
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
  }, CONFIG.RETRY_COUNT, CONFIG.RETRY_DELAY, "文本嵌入");
}

// 异步触发LLM函数
async function triggerLlmFunction(data) {
  try {
    console.log("异步触发LLM函数...");
    
    fetch(`${process.env.URL}/.netlify/functions/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(err => console.error("异步调用LLM函数失败:", err));
    
    console.log("LLM函数触发成功");
    return true;
  } catch (error) {
    console.error("触发LLM函数出错:", error);
    return false;
  }
}

// 主处理函数
exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // 处理CORS预检请求
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
    // 解析请求
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const question = body.question;
    
    // 生成或使用会话ID
    const sessionId = body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    if (!question) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "未提供问题" }) };
    }
    
    // 生成请求ID
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    console.log(`处理新请求: ${requestId}, 问题: "${question.substring(0, 50)}${question.length > 50 ? '...' : ''}"`);
    
    // 初始化请求存储
    saveToStorage(requestId, {
      status: "processing",
      question,
      sessionId,
      startTime
    });
    
    // 异步处理RAG查询
    // 注意：这里使用void操作符，不等待处理完成
    void (async () => {
      try {
        // 1. 向量化问题
        const queryVector = await embedText(question);
        console.log("问题向量生成成功，维度:", queryVector.length);
    
        // 2. 查询Pinecone向量数据库
        const pineconeResult = await safeQuery(queryVector, 5, true);
        const matches = pineconeResult.matches || [];
        console.log("Pinecone查询结果数量:", matches.length);
    
        // 3. 整理检索到的上下文文本
        let contextText = "";
        matches.forEach((match, idx) => {
          contextText += `【参考${idx + 1}】${match.metadata?.title || "未知标题"}: ${match.metadata?.content || "无内容"}\n`;
        });
    
        if (matches.length === 0) {
          contextText = "没有找到与问题直接相关的参考资料。";
        }
        console.log("上下文:", contextText.substring(0, 100) + (contextText.length > 100 ? "..." : ""));
    
        // 更新存储的请求状态
        saveToStorage(requestId, {
          status: "rag_completed",
          question,
          sessionId,
          contextText,
          startTime
        });
    
        // 4. 触发LLM处理
        await triggerLlmFunction({
          requestId,
          question,
          sessionId,
          contextText
        });
      } catch (error) {
        console.error("RAG处理过程中出错:", error);
        saveToStorage(requestId, {
          status: "failed",
          error: `RAG处理失败: ${error.message}`,
          sessionId,
          startTime
        });
      }
    })();
    
    // 立即返回请求ID，不等待处理完成
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        requestId,
        sessionId,
        status: "processing",
        message: "请求已接收，正在处理"
      })
    };
  } catch (err) {
    console.error("处理请求出错:", err);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "处理请求时出错",
        message: err.message,
        executionTime: Date.now() - startTime
      })
    };
  }
};