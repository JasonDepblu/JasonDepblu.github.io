const storage = require('./storage');

// 配置参数
const CONFIG = {
  STORAGE_EXPIRY: 600, // 存储数据10分钟后过期 (秒)
};

// 获取状态进度信息
function getProgressInfo(status) {
  switch(status) {
    case 'processing':
      return { step: 1, message: '正在处理中...' };
    case 'rag_completed':
      return { step: 2, message: '知识检索完成，正在生成回答...' };
    case 'llm_processing':
      return { step: 3, message: '正在生成回答...' };
    default:
      return { step: 1, message: '正在处理中...' };
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
    // 解析请求体
    console.log("收到状态查询请求");
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { requestId } = body;

    if (!requestId) {
      console.error("缺少requestId参数");
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          status: "error",
          error: "缺少requestId参数"
        })
      };
    }

    console.log(`查询请求 ${requestId} 的状态`);

    // 从存储中获取数据
    const result = await storage.getData(requestId);

    if (!result) {
      console.log(`未找到请求 ${requestId} 的数据`);
      return {
        statusCode: 200,  // 返回200状态码，前端更易处理
        headers,
        body: JSON.stringify({
          status: "not_found",
          error: "请求未找到或已过期",
          requestId
        })
      };
    }

    // 根据状态构造响应
    let response = {
      requestId,
      sessionId: result.sessionId,
      status: result.status
    };

    // 添加状态相关的数据
    if (result.status === 'completed') {
      response.answer = result.answer;
      if (result.startTime) {
        response.processingTime = result.completedAt - result.startTime;
      }
    } else if (result.status === 'failed') {
      response.error = result.error;
    } else {
      // 处理中状态添加进度信息
      response.progress = getProgressInfo(result.status);
    }

    // 添加时间戳
    response.timestamp = Date.now();

    console.log(`返回请求 ${requestId} 的状态: ${result.status}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error("处理状态查询请求出错:", err);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        status: "error",
        error: "处理请求时出错",
        message: err.message
      })
    };
  }
};

// 正确导出处理函数
module.exports = { handler };