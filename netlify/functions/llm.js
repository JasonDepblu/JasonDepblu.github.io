import fetch from 'node-fetch';

// 确保全局存储初始化
global.requestStorage = global.requestStorage || {};

// 配置参数
const CONFIG = {
  DEEPSEEK_TIMEOUT: 25000,      // 25秒DeepSeek模型生成超时
  RETRY_COUNT: 1,               // 重试次数
  RETRY_DELAY: 1000,            // 初始重试延迟(毫秒)
  MAX_HISTORY_LENGTH: 10,       // 历史记录最大长度
  STORAGE_EXPIRY: 10 * 60 * 1000, // 存储数据10分钟后过期
};

// 内存中的会话历史缓存
const chatHistoryStore = new Map();

// 存储函数 - 将数据保存到内存中
function saveToStorage(requestId, data) {
  // 添加过期时间
  const expiry = Date.now() + CONFIG.STORAGE_EXPIRY;
  global.requestStorage[requestId] = {
    ...data,
    expiry
  };
  
  console.log(`更新请求数据，ID: ${requestId}，状态: ${data.status}`);
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

// 获取会话历史
function getChatHistory(sessionId) {
  const now = Date.now();
  
  // 清理过期会话
  for (const [key, session] of chatHistoryStore.entries()) {
    if (now > session.expiry) {
      chatHistoryStore.delete(key);
      console.log(`已删除过期会话: ${key}`);
    }
  }

  // 获取或创建会话
  const sessionData = chatHistoryStore.get(sessionId);
  if (sessionData) {
    console.log(`找到会话历史，消息数: ${sessionData.messages.length}，会话ID: ${sessionId}`);
    // 更新过期时间
    sessionData.expiry = Date.now() + CONFIG.STORAGE_EXPIRY;
    return sessionData.messages;
  }
  
  console.log(`未找到会话历史，创建新会话: ${sessionId}`);
  return [];
}

// 更新会话历史
function updateChatHistory(sessionId, messages) {
  // 保留最近的消息
  const truncatedMessages = messages.slice(-CONFIG.MAX_HISTORY_LENGTH);
  
  chatHistoryStore.set(sessionId, {
    messages: truncatedMessages,
    expiry: Date.now() + CONFIG.STORAGE_EXPIRY
  });
  
  console.log(`已更新会话历史，消息数: ${truncatedMessages.length}，会话ID: ${sessionId}`);
  return true;
}

// 生成回答函数
async function generateAnswer(messages) {
  try {
    console.log("调用DeepSeek-R1模型生成回答...");
    console.log(`提示包含 ${messages.length} 条消息`);
    
    // 调用模型API
    const response = await withTimeout(
      fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-ai/DeepSeek-V3",
          messages: messages,
          temperature: 0.6,
          max_tokens: 1000,
          frequency_penalty: 0.2,
          presence_penalty: 0.2
        }),
      }),
      CONFIG.DEEPSEEK_TIMEOUT,
      "DeepSeek-R1调用"
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API错误: ${response.statusText} - ${errText}`);
    }

    const result = await response.json();
    console.log("DeepSeek API调用成功");
    return result.choices[0].message;
  } catch (error) {
    console.error("DeepSeek API调用失败:", error.message);
    
    // 尝试简化请求重试
    try {
      console.log("尝试简化请求后重试...");
      
      // 提取系统提示和最近的用户消息
      const systemPrompt = messages[0]; // 系统提示
      const userMessage = messages.find(msg => msg.role === 'user') || { role: 'user', content: '' };
      
      const simplifiedMessages = [
        systemPrompt,
        userMessage
      ];
      
      const fallbackResponse = await withTimeout(
        fetch("https://api.siliconflow.cn/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "deepseek-ai/DeepSeek-V3",
            messages: simplifiedMessages,
            temperature: 0.6,
            max_tokens: 800,
          }),
        }),
        CONFIG.DEEPSEEK_TIMEOUT - 5000,
        "DeepSeek-R1简化调用"
      );
      
      if (!fallbackResponse.ok) {
        throw new Error(`简化API调用错误: ${fallbackResponse.statusText}`);
      }
      
      const fallbackResult = await fallbackResponse.json();
      console.log("DeepSeek API简化调用成功");
      
      // 添加简化上下文提示
      const assistantMessage = fallbackResult.choices[0].message;
      assistantMessage.content = "（注：由于响应时间限制，此回答基于简化的上下文）\n\n" + assistantMessage.content;
      
      return assistantMessage;
    } catch (fallbackError) {
      console.error("简化调用也失败:", fallbackError.message);
      throw new Error("无法获取AI回答，请稍后重试。");
    }
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
    // 解析请求体
    console.log("收到LLM处理请求");
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { requestId, question, contextText, sessionId } = body;
    
    // 验证必要参数
    if (!requestId || !question || !sessionId || contextText === undefined) {
      console.error("缺少必要参数:", JSON.stringify(body));
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: "缺少必要参数" }) 
      };
    }
    
    console.log(`处理请求 ${requestId}，会话 ${sessionId}`);
    
    // 更新存储状态
    saveToStorage(requestId, {
      status: "llm_processing",
      question,
      sessionId,
      contextText,
      startTime: body.startTime || startTime
    });
    
    // 获取会话历史
    const chatHistory = getChatHistory(sessionId);
    
    // 构造提示消息
    let promptMessages = [
      { role: 'system', content: '你是一个技术论坛的AI助手，请根据下面的文章参考回答用户问题。如果没有相关参考资料，请告知用户你没有足够信息回答这个问题。保持对话的连贯性，记住用户之前提到的内容。' },
    ];
    
    // 添加历史记录
    if (chatHistory.length > 0) {
      console.log(`添加 ${chatHistory.length} 条历史消息到提示`);
      promptMessages = [...promptMessages, ...chatHistory];
    }
    
    // 添加当前问题和上下文
    promptMessages.push({ role: 'user', content: `问题：${question}\n\n文章参考：\n${contextText}` });
    
    try {
      // 生成回答
      const assistantMessage = await generateAnswer(promptMessages);
      console.log("获取到AI回答，长度:", assistantMessage.content.length);
      
      // 更新会话历史
      const updatedHistory = [...chatHistory];
      updatedHistory.push({ role: 'user', content: question }); // 添加用户问题
      updatedHistory.push(assistantMessage); // 添加助手回答
      
      // 存储更新后的历史
      updateChatHistory(sessionId, updatedHistory);
      
      // 更新请求状态为完成
      saveToStorage(requestId, {
        status: "completed",
        question,
        sessionId,
        contextText,
        answer: assistantMessage.content,
        startTime: body.startTime || startTime,
        completedAt: Date.now()
      });
      
      console.log(`请求 ${requestId} 处理完成`);
      
      // 返回成功状态
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    } catch (error) {
      console.error("生成回答时出错:", error);
      
      // 更新请求状态为失败
      saveToStorage(requestId, {
        status: "failed",
        error: error.message,
        question,
        sessionId,
        contextText,
        startTime: body.startTime || startTime,
        failedAt: Date.now()
      });
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message })
      };
    }
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