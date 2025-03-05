import fetch from 'node-fetch';
import { PineconeClient } from '@pinecone-database/pinecone';

let pineconeIndex;

try {
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
  if (!result.data || !result.data.embedding) {
    throw new Error("Invalid embedding response format.");
  }
  return result.data.embedding;
}

export async function handler(event, context) {
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
    const queryVector = await embedText(question);
    console.log("问题向量：", queryVector);
    if (!pineconeIndex) {
      throw new Error("Pinecone index 未初始化");
    }
    const pineconeResult = await pineconeIndex.query({
      vector: queryVector,
      topK: 5,
      includeMetadata: true,
    });
    const matches = pineconeResult.matches;
    console.log("Pinecone 查询结果：", matches);
    let contextText = "";
    matches.forEach((match, idx) => {
      contextText += `【参考${idx + 1}】${match.metadata.title}: ${match.metadata.content}\n`;
    });
    const promptMessages = [
      { role: 'system', content: '你是一个技术论坛的AI助手，请根据下面的文章参考回答用户问题。' },
      { role: 'user', content: `问题：${question}\n\n文章参考：\n${contextText}` }
    ];
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
}