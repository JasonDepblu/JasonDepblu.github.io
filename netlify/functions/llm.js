// llm.js 修改
exports.handler = async (event, context) => {
  // 处理请求
  const { requestId, question, contextText, sessionId } = JSON.parse(event.body);

  try {
    // 生成回答...

    // 保存结果
    saveToStorage(requestId, {
      status: "completed",
      answer,
      sessionId
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (error) {
    saveToStorage(requestId, {
      status: "failed",
      error: error.message,
      sessionId
    });
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
}