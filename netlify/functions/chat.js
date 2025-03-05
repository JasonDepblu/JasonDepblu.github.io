import fetch from 'node-fetch';
import { Pinecone } from '@pinecone-database/pinecone';

let pineconeIndex = null;
let pineconeClient = null;

async function initPinecone() {
  if (pineconeIndex) return pineconeIndex;
  try {
    console.log("正在初始化 Pinecone...");
    console.log(`API Key: ${process.env.PINECONE_API_KEY ? "已设置" : "未设置"}`);
    console.log(`索引名称: ${process.env.PINECONE_INDEX}`);

    // 创建Pinecone客户端并保存到全局变量
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    console.log("Pinecone 客户端创建成功");

    // 获取索引实例
    pineconeIndex = pineconeClient.index(process.env.PINECONE_INDEX);
    console.log("Pinecone index 初始化成功");
    return pineconeIndex;
  } catch (err) {
    console.error("初始化 Pinecone 出错:", err);
    throw err;
  }
}

// 修复后的查询函数
async function safeQuery(vector, topK = 5, includeMetadata = true) {
  try {
    const idx = await initPinecone();

    // 确保向量是数组，而不是对象
    if (!Array.isArray(vector)) {
      console.error("向量不是数组格式:", typeof vector);
      if (typeof vector === 'object') {
        console.log("尝试将对象转换为数组...");
        // 如果是类数组对象，尝试转换为数组
        vector = Object.values(vector);
      } else {
        throw new Error("无效的向量格式");
      }
    }

    console.log("准备查询 Pinecone...");
    console.log(`向量维度: ${vector.length}`);

    // 确保传递给 Pinecone 的是正确的查询格式
    const queryResponse = await idx.query({
      vector: vector,
      topK: topK,
      includeMetadata: includeMetadata,
    });

    return queryResponse;
  } catch (error) {
    console.error("Pinecone 查询失败:", error);
    // 返回空匹配结果
    return { matches: [] };
  }
}

const index = {
  query: safeQuery
};

// 由于Pinecone的嵌入API可能有问题，回退到使用SiliconFlow的嵌入API
async function embedText(text) {
  try {
    console.log("使用SiliconFlow API生成嵌入向量...");

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
    console.log("嵌入API响应成功");

    // 提取向量数据
    let embedding = null;
    if (result.data && Array.isArray(result.data) && result.data.length > 0 && result.data[0].embedding) {
      embedding = result.data[0].embedding;
    } else if (result.data && result.data.embedding) {
      embedding = result.data.embedding;
    } else if (result.embedding) {
      embedding = result.embedding;
    }

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("无法从响应中提取向量数据");
    }

    console.log(`成功生成向量，维度: ${embedding.length}`);
    return embedding;
  } catch (error) {
    console.error("生成嵌入向量失败:", error);
    throw error;
  }
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
    console.log("问题向量生成成功，维度:", queryVector.length);

    // 2. 查询 Pinecone 向量数据库
    const pineconeResult = await index.query({
      vector: queryVector,
      topK: 5,
      includeMetadata: true,
    });
    const matches = pineconeResult.matches || [];
    console.log("Pinecone 查询结果数量:", matches.length);

    // 3. 整理检索到的上下文文本
    let contextText = "";
    matches.forEach((match, idx) => {
      contextText += `【参考${idx + 1}】${match.metadata?.title || "未知标题"}: ${match.metadata?.content || "无内容"}\n`;
    });

    // 如果没有匹配结果，提供一个友好的回复
    if (matches.length === 0) {
      contextText = "没有找到与问题直接相关的参考资料。";
    }

    // 4. 构造对话提示
    const promptMessages = [
      { role: 'system', content: '你是一个技术论坛的AI助手，请根据下面的文章参考回答用户问题。如果没有相关参考资料，请告知用户你没有足够信息回答这个问题。' },
      { role: 'user', content: `问题：${question}\n\n文章参考：\n${contextText}` },
    ];

    // 5. 调用硅基流动 API 使用 DeepSeek-R1 模型生成回答
    const deepseekRes = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "Pro/deepseek-ai/DeepSeek-R1", // 使用硅基流动提供的 DeepSeek-R1 模型
        messages: promptMessages,
        temperature: 0.6,
      }),
    });

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      throw new Error(`硅基流动 DeepSeek-R1 API 请求失败: ${deepseekRes.statusText} - ${errText}`);
    }

    const deepseekData = await deepseekRes.json();
    const answer = deepseekData.choices?.[0]?.message?.content || "很抱歉，我无法生成回答。";
    console.log("使用硅基流动 DeepSeek-R1 模型生成回答成功");

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