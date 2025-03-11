exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "测试函数正常工作！" })
  };
};