// netlify/functions/status-background/index.js
const sessionStore = require('../shared-background/session_store.js');

exports.handler = async (event, context) => {
  // 增加对 OPTIONS 请求的处理，支持 CORS 预检
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

  // 检查请求方法
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

  // 处理主要逻辑
  try {
    console.log("Status function called");
    console.log("HTTP Method:", event.httpMethod);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error("Error parsing request body:", parseError);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: "Invalid JSON in request body" })
      };
    }

    const requestId = body.requestId;
    if (!requestId) {
      console.error("Missing requestId");
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: "Missing requestId" })
      };
    }

    // 加载所有会话
    let allSessions;
    try {
      allSessions = sessionStore.getAllSessions();
      console.log("Available sessions:", Object.keys(allSessions).length);
    } catch (sessionError) {
      console.error("Error loading sessions:", sessionError);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: "Failed to load sessions" })
      };
    }

    // 在所有会话中搜索请求
    let found = false;
    let response = {
      requestId: requestId,
      status: "unknown"
    };

    for (const sessionId in allSessions) {
      const session = allSessions[sessionId];
      const currentRequest = session?.current_request;

      if (currentRequest && currentRequest.id === requestId) {
        found = true;
        console.log(`Found request ${requestId} in session ${sessionId}`);

        response = {
          requestId: requestId,
          sessionId: sessionId,
          status: currentRequest.status
        };

        if (currentRequest.status === 'completed') {
          response.answer = currentRequest.answer;
          const processingTime = (currentRequest.completed_at - currentRequest.started_at) / 1000;
          response.processingTime = Math.round(processingTime * 100) / 100;
        } else if (currentRequest.status === 'failed') {
          response.error = currentRequest.error;
        }

        break;
      }
    }

    if (!found) {
      console.log(`Request ${requestId} not found in any session`);
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          requestId: requestId,
          status: "unknown",
          error: "Request not found in any session"
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("Status function error:", error);
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