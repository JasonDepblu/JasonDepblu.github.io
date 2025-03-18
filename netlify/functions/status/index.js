// functions/status/index.js
const fs = require('fs');
const path = require('path');

// 添加调试日志
const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log(...args);
}

// 明确定义会话文件路径
const SESSION_FILE = path.join('/tmp', 'sessions.json');

// 健壮的文件读取
const safeReadFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      log(`读取文件成功，大小: ${data.length} 字节`);
      return data;
    }
    log(`文件不存在: ${filePath}`);
    return null;
  } catch (error) {
    log(`读取文件错误 ${filePath}:`, error);
    return null;
  }
};

// 健壮的JSON解析
const safeParseJSON = (jsonString) => {
  if (!jsonString) return null;

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    log("JSON解析错误:", error);
    // 检查是否是压缩或编码的数据
    if (jsonString.startsWith('H4s')) {
      log("文件似乎是经过压缩或编码的，无法解析");
    }
    return null;
  }
};

// 直接从文件读取会话数据
function readSessionsFromFile() {
  try {
    log(`尝试读取会话文件: ${SESSION_FILE}`);

    // 尝试读取文件
    const data = safeReadFile(SESSION_FILE);

    // 如果文件不存在或为空，返回空对象
    if (!data) {
      log('会话文件不存在或为空，返回空对象');
      return {};
    }

    // 尝试解析JSON
    const parsed = safeParseJSON(data);

    // 如果解析失败，记录错误并返回空对象
    if (!parsed) {
      log('会话文件无法解析为JSON，返回空对象');
      log('文件前50个字符:', data.substring(0, 50));
      return {};
    }

    log(`成功读取 ${Object.keys(parsed).length} 个会话`);
    return parsed;
  } catch (error) {
    log("读取会话文件出错:", error);
    return {};
  }
}

// 处理 status 请求的函数
exports.handler = async (event, context) => {
  // 记录请求详情
  log("Status-background 函数被调用");
  log("HTTP 方法:", event.httpMethod);
  log("请求路径:", event.path);
  log("查询参数:", JSON.stringify(event.queryStringParameters));

  // 支持 GET 和 POST 两种请求方法
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET' && event.httpMethod !== 'OPTIONS') {
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

    // 检查状态请求所需参数
    const { requestId, sessionId } = requestData;

    if (!requestId || !sessionId) {
      log("缺少必要参数: requestId 或 sessionId");
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "必须提供 requestId 和 sessionId",
          provided: requestData
        })
      };
    }

    // 直接从文件读取会话数据
    const sessions = readSessionsFromFile();
    log(`找到 ${Object.keys(sessions).length} 个会话`);
    if (Object.keys(sessions).length > 0) {
      log(`会话ID列表: ${Object.keys(sessions).join(', ')}`);
    }

    // 添加直接响应选项 - 用于测试
    if (requestData.directResponse === 'true') {
      log("请求了直接响应，返回会话数据");
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          sessionCount: Object.keys(sessions).length,
          sessionIds: Object.keys(sessions),
          requestIds: Object.keys(sessions).map(sid => {
            const session = sessions[sid];
            return session && session.current_request ? session.current_request.id : null;
          }).filter(Boolean)
        })
      };
    }

    // 检查会话是否存在
    const session = sessions[sessionId];
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
          sessionId: sessionId,
          availableSessions: Object.keys(sessions)
        })
      };
    }

    // 检查请求是否存在
    const currentRequest = session.current_request;
    log("当前请求信息:", currentRequest ?
      JSON.stringify({
        id: currentRequest.id,
        status: currentRequest.status,
        hasAnswer: !!currentRequest.answer
      }) : "不存在");

    if (!currentRequest) {
      log("请求不存在");
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "请求未找到",
          details: "会话中不存在当前请求",
          sessionData: {
            hasHistory: !!session.history,
            historyLength: session.history ? session.history.length : 0
          }
        })
      };
    }

    // 检查请求ID是否匹配
    if (currentRequest.id !== requestId) {
      log("请求 ID 不匹配:", currentRequest.id, "!==", requestId);
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "请求未找到",
          details: "请求ID不匹配",
          expected: requestId,
          actual: currentRequest.id
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
    log("错误:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: "服务器错误: " + error.message,
        stack: error.stack
      })
    };
  }
};

