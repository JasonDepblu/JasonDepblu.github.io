// netlify/functions/chat.js
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ------------------------------
// 1. 初始化 Pinecone 客户端（使用动态 import）
// ------------------------------
let pineconeIndex;

(async () => {
  try {
    // 动态导入 PineconeClient 模块
    const { PineconeClient } = await import('@pinecone-database/pinecone');
    const pinecone = new PineconeClient();
    await pinecone.init({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });
    pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);
    console.log("Pinecone index 初始化成功");
  } catch (err) {
    console.error("初始化 Pinecone 出错:", err);
  }
})();

// ------------------------------
// 2. 定义查询函数，使用真实的 Pinecone 查询逻辑
// ------------------------------
const index = {
  async query({ vector, topK, includeMetadata }) {
    if (!pineconeIndex) {
      throw new Error("Pinecone index 未初始化");
    }
    // 调用 Pinecone SDK 的 query 接口
    const queryResponse = await pineconeIndex.query({
      vector,
      topK,
      includeMetadata,
    });
    return queryResponse;
  }
};

// ------------------------------
// 3. 嵌入函数：调用硅基流动 API 获取文本嵌入
// ------------------------------
async function embedText(text) {
  const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`
    },
    body: JSON.stringify({
      model: "Pro/BAAI/bge-m3",
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding API request failed: ${response.statusText}`);
  }

  const result = await response.json();
  // 假设返回数据格式为：{ data: { embedding: [0.1, 0.2, 0.3, ...] } }
  if (!result.data || !result.data.embedding) {
    throw new Error("Invalid embedding response format.");
  }
  return result.data.embedding;
}

// ------------------------------
// 4. 主函数：处理请求，生成回答并返回给前端
// ------------------------------
exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = JSON.parse(event.body);
    const question = body.question;
    if (!question) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No question provided" }) };
    }

    // 1. 向量化问题
    const queryVector = await embedText(question);
    console.log("问题向量：", queryVector);

    // 2. 查询 Pinecone 向量数据库
    const pineconeResult = await index.query({
      vector: queryVector,
      topK: 5,
      includeMetadata: true
    });
    const matches = pineconeResult.matches;
    console.log("Pinecone 查询结果：", matches);

    // 3. 整理检索到的上下文文本
    let contextText = "";
    matches.forEach((match, idx) => {
      contextText += `【参考${idx + 1}】${match.metadata.title}: ${match.metadata.content}\n`;
    });

    // 4. 构造 DeepSeek-R1 的对话提示
    const promptMessages = [
      { role: 'system', content: '你是一个技术论坛的AI助手，请根据下面的文章参考回答用户问题。' },
      { role: 'user', content: `问题：${question}\n\n文章参考：\n${contextText}` }
    ];

    // 5. 调用 DeepSeek-R1 API 生成回答
    const deepseekRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "DeepSeek-R1",
        messages: promptMessages,
        temperature: 0.7
      })
    });

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      throw new Error(`DeepSeek-R1 API request failed: ${deepseekRes.statusText} - ${errText}`);
    }

    const deepseekData = await deepseekRes.json();
    const answer = deepseekData.choices?.[0]?.message?.content || "很抱歉，我无法生成回答。";
    console.log("生成的回答：", answer);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer })
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message })
    };
  }
};