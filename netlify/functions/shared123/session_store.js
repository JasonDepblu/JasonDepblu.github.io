// functions/status/index.js
const sessionStore = require('.//session_store.js');

// 添加调试日志
const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log(...args);
}

// 辅助函数：检查字符串是否为有效ID（更宽松的验证）
function isValidId(id) {
  if (typeof id !== 'string') return false;
  if (id.trim() === '') return false;
  return true;
}

// 处理 status 请求的函数
exports.handler = async (event, context) => {
  // 设置 callbackWaitsForEmptyEventLoop 为 false，以便支持 Netlify 的异步处理
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  // 记录所有请求信息，便于调试
  log("status 请求详情:", {
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    queryParams: event.queryStringParameters,
    body: event.body ? "存在" : "不存在"
  });

  // 添加 CORS 支持
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

  log("Status-background 函数被调用");
  log("HTTP 方法:", event.httpMethod);

  // 支持 GET 和 POST 两种请求方法
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    log("不支持的 HTTP 方法:", event.httpMethod);
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: "方法不被允许。使用 POST 或 GET。" })
    };
  }

  try {
    // 解析请求参数
    let requestData = {};

    if (event.httpMethod === 'POST') {
      // POST 请求 - 从请求体获取数据
      try {
        requestData = JSON.parse(event.body || '{}');
        log("POST 请求体:", JSON.stringify(requestData));
      } catch (parseError) {
        log("解析 POST 请求体失败:", parseError);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            error: "无效的 JSON 请求体",
            details: parseError.message
          })
        };
      }
    } else if (event.httpMethod === 'GET') {
      // GET 请求 - 从查询参数获取数据
      requestData = event.queryStringParameters || {};
      log("GET 查询参数:", JSON.stringify(requestData));
    }

    // 检查是否是更新会话的请求（来自流式处理后的更新）
    if (requestData.updateSession === true) {
      log("处理流式处理后的会话更新");

      const { sessionId, question, answer } = requestData;

      if (!isValidId(sessionId) || !answer) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            error: "更新会话需要有效的 sessionId 和 answer",
            providedSessionId: sessionId,
            hasAnswer: !!answer
          })
        };
      }

      try {
        // 获取会话
        const session = sessionStore.getSession(sessionId) || {};
        const history = session.history || [];

        // 更新会话历史
        const updatedHistory = [...history, {
          user: question || "用户问题",
          assistant: answer
        }];

        // 保存更新的会话
        sessionStore.updateSession(sessionId, 'history', updatedHistory);
        log(`会话 ${sessionId} 的历史已更新`);

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify({
            success: true,
            message: "会话已更新",
            sessionId: sessionId
          })
        };
      } catch (updateError) {
        log("更新会话失败:", updateError);
        return {
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            error: "更新会话失败",
            details: updateError.message
          })
        };
      }
    }

    // 检查状态请求所需参数
    const { requestId, sessionId } = requestData;

    // 使用更宽松的 ID 验证
    if (!isValidId(requestId) || !isValidId(sessionId)) {
      log("缺少必要参数或格式无效:", {
        requestId: requestId,
        sessionId: sessionId,
        requestIdValid: isValidId(requestId),
        sessionIdValid: isValidId(sessionId)
      });

      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "必须提供有效的 requestId 和 sessionId",
          providedRequestId: requestId,
          providedSessionId: sessionId
        })
      };
    }

    // 从会话存储中获取请求状态
    let session;
    try {
      session = sessionStore.getSession(sessionId);
      log("查找的会话ID:", sessionId);
      log("获取到的会话:", session ? "存在" : "不存在");

      if (session) {
        log("会话内容:", JSON.stringify({
          hasHistory: !!session.history,
          historyLength: session.history ? session.history.length : 0,
          hasCurrentRequest: !!session.current_request,
          requestId: session.current_request ? session.current_request.id : null
        }));
      }
    } catch (sessionError) {
      log("获取会话时出错:", sessionError);

      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "获取会话数据失败",
          details: sessionError.message
        })
      };
    }

    if (!session) {
      log("会话未找到:", sessionId);
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "会话未找到",
          providedSessionId: sessionId
        })
      };
    }

    const currentRequest = session.current_request;
    log("当前请求信息:", currentRequest ? JSON.stringify({
      id: currentRequest.id,
      status: currentRequest.status,
      hasAnswer: !!currentRequest.answer,
      answerLength: currentRequest.answer ? currentRequest.answer.length : 0
    }) : "不存在");

    if (!currentRequest) {
      log("当前请求不存在");
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "请求未找到",
          details: "会话中不存在当前请求"
        })
      };
    }

    // 使用更宽松的请求ID匹配检查
    if (currentRequest.id !== requestId) {
      log("请求 ID 不匹配:", {
        expected: requestId,
        actual: currentRequest.id
      });

      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "请求未找到",
          details: "请求ID与当前会话中的请求不匹配",
          expectedId: requestId,
          actualId: currentRequest.id
        })
      };
    }

    // 返回请求的当前状态
    log(`请求 ${requestId} 的状态: ${currentRequest.status}`);

    if (currentRequest.status === 'completed') {
      const responseData = {
        status: 'completed',
        sessionId: sessionId,
        requestId: requestId,
        answer: currentRequest.answer,
        completed_at: currentRequest.completed_at
      };

      log(`返回已完成状态 (答案长度: ${currentRequest.answer?.length || 0})`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(responseData)
      };
    } else if (currentRequest.status === 'failed') {
      const responseData = {
        status: 'failed',
        sessionId: sessionId,
        requestId: requestId,
        error: currentRequest.error || "处理请求时出错",
        completed_at: currentRequest.completed_at
      };

      log(`返回失败状态: ${currentRequest.error}`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(responseData)
      };
    } else {
      // 请求仍在处理中
      const responseData = {
        status: 'processing',
        sessionId: sessionId,
        requestId: requestId,
        message: "请求正在处理中",
        started_at: currentRequest.started_at
      };

      log("返回处理中状态");

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(responseData)
      };
    }
  } catch (error) {
    log("处理请求时发生错误:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: "服务器错误: " + error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};