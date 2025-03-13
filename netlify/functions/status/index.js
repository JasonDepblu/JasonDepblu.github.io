const sessionStore = require('../shared/session_store.js');

exports.handler = async (event, context) => {
  try {
    console.log("Status function called");

    const body = JSON.parse(event.body || '{}');
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
    const allSessions = sessionStore.getAllSessions();
    console.log("Available sessions:", Object.keys(allSessions));

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
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("Status function error:", error);
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