// 使用 require 语法导入所有依赖（CommonJS 风格）
const fetch = require('node-fetch');
const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs');

// 配置参数
const CONFIG = {
  FETCH_TIMEOUT: 8000,          // 8秒API调用超时
  PINECONE_TIMEOUT: 6000,       // 6秒Pinecone操作超时
  RETRY_COUNT: 1,               // 重试次数
  RETRY_DELAY: 500,             // 初始重试延迟(毫秒)
  STORAGE_EXPIRY: 600,          // 存储数据10分钟后过期 (秒)
};

// ========== 内联存储实现 ==========
// 在这里内联存储函数，而不是导入外部模块

// 文件存储配置
const FILE_STORAGE_PATH = '/tmp/request_data.json';

/**
 * 获取当前存储的所有数据
 */
async function getStorageData() {
  try {
    if (!fs.existsSync(FILE_STORAGE_PATH)) {
      return {};
    }

    const data = await fs.promises.readFile(FILE_STORAGE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("读取存储文件失败:", error);
    return {};
  }
}

/**
 * 将数据写入文件
 */
async function writeStorageData(data) {
  try {
    await fs.promises.writeFile(
      FILE_STORAGE_PATH,
      JSON.stringify(data, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    console.error("写入存储文件失败:", error);
    return false;
  }
}

/**
 * 保存数据到存储
 */
async function saveData(key, data, expirySeconds = 600) {
  try {
    // 添加过期时间
    const expiry = Date.now() + (expirySeconds * 1000);
    const storageData = {
      ...data,
      expiry
    };

    // 保存到文件
    const allData = await getStorageData();
    allData[key] = storageData;
    await writeStorageData(allData);

    return true;
  } catch (error) {
    console.error(`保存数据失败 (${key}):`, error);
    return false;
  }
}

/**
 * 从存储获取数据
 */
async function getData(key) {
  try {
    const allData = await getStorageData();
    const data = allData[key];

    // 检查数据是否过期
    if (data && data.expiry && data.expiry < Date.now()) {
      // 删除并返回 null
      delete allData[key];
      await writeStorageData(allData);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error(`获取数据失败 (${key}):`, error);
    return null;
  }
}

/**
 * 删除数据
 */
async function deleteData(key) {
  try {
    const allData = await getStorageData();
    if (key in allData) {
      delete allData[key];
      await writeStorageData(allData);
    }
    return true;
  } catch (error) {
    console.error(`删除数据失败 (${key}):`, error);
    return false;
  }
}

// ========== 其他函数实现 ==========

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

    // 使用更可靠的触发方式
    try {
      await fetch(`${process.env.URL}/.netlify/functions/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        // 增加超时时间
        timeout: 5000
      });
      console.log("LLM函数触发成功");
    } catch (err) {
      console.error("异步调用LLM函数失败:", err);
      // 重要：失败后立即重试一次
      setTimeout(() => {
        fetch(`${process.env.URL}/.netlify/functions/llm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }).catch(e => console.error("LLM函数重试也失败:", e));
      }, 1000);
    }

    return true;
  } catch (error) {
    console.error("触发LLM函数出错:", error);
    return false;
  }
}

// 主处理函数
const handler = async (event, context) => {
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
    await saveData(requestId, {
      status: "processing",
      question,
      sessionId,
      startTime
    }, CONFIG.STORAGE_EXPIRY);

    console.log(`初始化请求存储成功: ${requestId}`);

    // 异步处理RAG查询
    // 注意：这里使用void操作符，不等待处理完成
    void (async () => {
      try {
        console.log(`开始异步处理请求: ${requestId}`);

        // 1. 向量化问题
        const queryVector = await embedText(question);
        console.log(`问题向量生成成功，维度: ${queryVector.length}`);

        // 2. 查询Pinecone向量数据库
        const pineconeResult = await safeQuery(queryVector, 5, true);
        const matches = pineconeResult.matches || [];
        console.log(`Pinecone查询结果数量: ${matches.length}`);

        // 3. 整理检索到的上下文文本
        let contextText = "";
        matches.forEach((match, idx) => {
          contextText += `【参考${idx + 1}】${match.metadata?.title || "未知标题"}: ${match.metadata?.content || "无内容"}\n`;
        });

        if (matches.length === 0) {
          contextText = "没有找到与问题直接相关的参考资料。";
        }
        console.log(`上下文: ${contextText.substring(0, 100)}${contextText.length > 100 ? "..." : ""}`);

        // 更新存储的请求状态
        await saveData(requestId, {
          status: "rag_completed",
          question,
          sessionId,
          contextText,
          startTime
        }, CONFIG.STORAGE_EXPIRY);

        console.log(`RAG处理完成，更新存储状态: ${requestId}`);

        // 4. 触发LLM处理
        await triggerLlmFunction({
          requestId,
          question,
          sessionId,
          contextText
        });
      } catch (error) {
        console.error(`RAG处理过程中出错 (${requestId}):`, error);
        await saveData(requestId, {
          status: "failed",
          error: `RAG处理失败: ${error.message}`,
          sessionId,
          startTime
        }, CONFIG.STORAGE_EXPIRY);
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

// 正确导出处理函数
module.exports = { handler };