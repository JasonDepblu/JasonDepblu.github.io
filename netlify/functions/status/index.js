// functions/status/index.js
const { sessionManager, readSessions } = require('../utils/session-manager');

// 调试标志
const DEBUG = process.env.NODE_ENV === 'development';

function log(...args) {
  if (DEBUG) console.log(...args);
}

exports.handler = async (event, context) => {
  // Log request details with full data visibility
  console.log("Status function called");
  console.log("HTTP Method:", event.httpMethod);
  console.log("Raw body:", event.body);
  console.log("Query parameters:", JSON.stringify(event.queryStringParameters));

  // Support OPTIONS for CORS
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
    // Improved request parsing with more debugging
    let requestData = {};
    let parseSource = ''; // Track where we got the data from

    if (event.httpMethod === 'POST') {
      // Try multiple parsing strategies
      if (event.body) {
        // Log the raw body for debugging
        console.log("Raw body type:", typeof event.body);
        console.log("Raw body preview:", event.body.substring(0, 100));

        // Strategy 1: Parse as JSON if content-type is application/json
        if (event.headers['content-type']?.includes('application/json')) {
          try {
            requestData = JSON.parse(event.body);
            parseSource = 'json-body';
            console.log("Parsed as JSON:", requestData);
          } catch (e) {
            console.error("JSON parse error:", e.message);
          }
        }

        // Strategy 2: Parse as form data if content-type is application/x-www-form-urlencoded
        else if (event.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
          try {
            const params = new URLSearchParams(event.body);
            requestData.requestId = params.get('requestId');
            requestData.sessionId = params.get('sessionId');
            parseSource = 'form-data';
            console.log("Parsed as form data:", requestData);
          } catch (e) {
            console.error("Form parse error:", e.message);
          }
        }

        // Strategy 3: Fallback - try JSON parse regardless of content-type
        if (!parseSource && !requestData.requestId) {
          try {
            requestData = JSON.parse(event.body);
            parseSource = 'fallback-json';
            console.log("Parsed with fallback JSON:", requestData);
          } catch (e) {
            console.error("Fallback JSON parse error:", e.message);
          }
        }
      }
    }

    // Strategy 4: Always check query parameters as final fallback
    if ((!parseSource || !requestData.requestId) && event.queryStringParameters) {
      requestData = {
        ...requestData,
        ...event.queryStringParameters
      };
      parseSource = parseSource ? `${parseSource}+query` : 'query-params';
      console.log("Using query parameters:", requestData);
    }

    // Log what we found
    console.log("Final request data (from " + parseSource + "):", requestData);

    // Extract and validate parameters
    // Extract and validate parameters
    const requestId = requestData.requestId;
    let sessionId = requestData.sessionId;

    // Special handling for the string "null"
    if (sessionId === "null") {
      console.log("Received 'null' as string value for sessionId");
      sessionId = null;
    }

    // Validate parameters
    if (!requestId || !sessionId) {
      console.log("Missing required parameters:", {
        hasRequestId: !!requestId,
        hasSessionId: !!sessionId,
        rawSessionId: requestData.sessionId
      });

      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "Missing required parameters",
          message: sessionId === null ?
            "Session ID is null. Wait for valid session ID before polling." :
            "Both requestId and sessionId are required",
          requestId: requestId,
          receivedSessionId: requestData.sessionId
        })
      };
    }

    // 检查会话存在性
    const session = sessionManager.getSession(sessionId);
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
          availableSessions: Object.keys(sessionManager.getAllSessions())
        })
      };
    }

    // 首先在 pendingRequests 中检查
    const pendingRequests = session.pendingRequests || {};
    if (pendingRequests[requestId]) {
      const requestData = pendingRequests[requestId];
      log(`在 pendingRequests 中找到请求: ${requestId}, 状态: ${requestData.status}`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          status: requestData.status || 'processing',
          sessionId: sessionId,
          requestId: requestId,
          answer: requestData.answer,
          completed_at: requestData.completed_at,
          error: requestData.error
        })
      };
    }

    // 接着检查 current_request
    const currentRequest = session.current_request;
    if (!currentRequest) {
      log("current_request 不存在且在 pendingRequests 中未找到匹配请求");
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "请求未找到",
          details: "会话中无匹配请求",
          requestId: requestId,
          sessionData: {
            hasHistory: !!session.history,
            historyLength: session.history ? session.history.length : 0,
            hasPendingRequests: Object.keys(pendingRequests).length > 0,
            pendingRequestIds: Object.keys(pendingRequests)
          }
        })
      };
    }

    // 检查请求 ID 是否匹配
    if (currentRequest.id !== requestId) {
      log(`current_request ID 不匹配: ${currentRequest.id} !== ${requestId}`);

      // 如果这似乎是一个新请求，将其添加到 pendingRequests 中标记为"处理中"
      if (session && session.history) {
        log(`将 ${requestId} 视为新请求`);

        sessionManager.updateRequestStatus(sessionId, requestId, 'processing');
        sessionManager.saveNow();

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify({
            status: 'processing',
            sessionId: sessionId,
            requestId: requestId,
            message: "请求已识别并正在处理中"
          })
        };
      }

      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: "请求未找到",
          details: "current_request.id 不匹配且在 pendingRequests 中未找到匹配请求",
          expected: requestId,
          actual: currentRequest.id,
          pendingRequestIds: Object.keys(pendingRequests)
        })
      };
    }

    // 根据 current_request 返回当前状态
    log(`请求 ${requestId} 状态: ${currentRequest.status}`);

    if (currentRequest.status === 'completed') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          status: 'completed',
          sessionId: sessionId,
          requestId: requestId,
          answer: currentRequest.answer,
          completed_at: currentRequest.completed_at
        })
      };
    } else if (currentRequest.status === 'failed') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          status: 'failed',
          sessionId: sessionId,
          requestId: requestId,
          error: currentRequest.error || "处理请求时出错",
          completed_at: currentRequest.completed_at
        })
      };
    } else {
      // 请求仍在处理中
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          status: 'processing',
          sessionId: sessionId,
          requestId: requestId,
          message: "请求正在处理中",
          started_at: currentRequest.started_at
        })
      };
    }
  } catch (error) {
    console.error("Error in status handler:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};