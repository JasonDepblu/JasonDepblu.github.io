// status.js - 新增函数
exports.handler = async (event, context) => {
  const { requestId } = JSON.parse(event.body);

  // 从存储中获取结果
  const result = getFromStorage(requestId);

  if (!result) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "请求未找到" })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
}