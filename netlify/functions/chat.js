const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

let pineconeIndex = null;

async function initPinecone() {
  if (pineconeIndex) return pineconeIndex;
  try {
    // 动态导入 PineconeClient 模块
    const { default: PineconeClient } = await import('@pinecone-database/pinecone');
    const pinecone = new PineconeClient();
    await pinecone.init({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });
    pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);
    console.log("Pinecone index 初始化成功");
    return pineconeIndex;
  } catch (err) {
    console.error("初始化 Pinecone 出错:", err);
    throw err;
  }
}

const index = {
  async query({ vector, topK, includeMetadata }) {
    const idx = await initPinecone();
    const queryResponse = await idx.query({
      vector,
      topK,
      includeMetadata,
    });
    return queryResponse;
  }
};

async function embedText(text) {
  const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({
      model: "Pro/BAAI/bge-m3",
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API request failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (!result.data || !result.data.embedding) {
    throw new Error("Invalid embedding response format.");
  }
  return result.data.embedding;
}

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
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
      includeMetadata: true,
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
      { role: 'user', content: `问题：${question}\n\n文章参考：\n${contextText}` },
    ];

    // 5. 调用 DeepSeek-R1 API 生成回答
    const deepseekRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "DeepSeek-R1",
        messages: promptMessages,
        temperature: 0.7,
      }),
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
      body: JSON.stringify({ answer }),
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message }),
    };
  }
};