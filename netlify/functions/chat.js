import fetch from 'node-fetch';

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
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { question, sessionId } = body;

    if (!question) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "请提供问题" })
      };
    }

    console.log(`处理问题: "${question.substring(0, 50)}${question.length > 50 ? '...' : ''}"`);
    console.log(`会话ID: ${sessionId || '新会话'}`);

    // 第一阶段: 调用RAG函数获取上下文
    console.log("第一阶段: 调用RAG函数...");
    const ragResponse = await fetch(`${process.env.SITE_URL}/.netlify/functions/rag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, sessionId })
    });

    if (!ragResponse.ok) {
      const errorText = await ragResponse.text();
      throw new Error(`RAG处理失败: ${ragResponse.statusText} - ${errorText}`);
    }

    const ragResult = await ragResponse.json();

    if (!ragResult.success) {
      throw new Error(ragResult.error || "RAG处理返回错误");
    }

    console.log(`RAG处理完成，耗时: ${ragResult.executionTime}ms`);

    // 第二阶段: 调用LLM函数生成回答
    console.log("第二阶段: 调用LLM函数...");
    const llmResponse = await fetch(`${process.env.SITE_URL}/.netlify/functions/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ragResult.data)
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM处理失败: ${llmResponse.statusText} - ${errorText}`);
    }

    const llmResult = await llmResponse.json();

    // 获取最终答案
    const totalTime = Date.now() - startTime;
    console.log(`处理完成，总耗时: ${totalTime}ms`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: llmResult.answer,
        sessionId: llmResult.sessionId,
        totalTime
      })
    };

  } catch (error) {
    console.error("处理错误:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "处理请求时出错",
        message: error.message,
        totalTime: Date.now() - startTime
      })
    };
  }
};