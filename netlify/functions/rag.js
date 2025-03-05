// rag.js 修改
exports.handler = async (event, context) => {
  // 常规 RAG 处理...

  // 生成唯一标识符
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  // 将处理结果保存到某个存储中（可以是共享内存、数据库或文件系统）
  saveToStorage(requestId, {
    status: "processing",
    ragResult: contextText,
    sessionId,
    question
  });

  // 异步触发 LLM 函数 - 不等待其完成
  fetch(`${process.env.SITE_URL}/.netlify/functions/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, sessionId, question, contextText })
  }).catch(err => console.error("异步调用 LLM 失败:", err));

  // 立即返回请求 ID
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      requestId,
      status: "processing",
      sessionId
    })
  };
}