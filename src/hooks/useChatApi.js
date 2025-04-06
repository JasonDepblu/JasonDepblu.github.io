// src/hooks/useChatApi.js
import { useState, useCallback, useEffect } from 'react';
import { getApiUrl } from '../utils/apiConfig';
import { GREETING_CACHE } from '../utils/greetingCache';

// 轮询间隔和最大尝试次数
const POLL_INTERVAL = 3000;
const MAX_POLL_ATTEMPTS = 60;

const API_URL = getApiUrl();

// 辅助函数：带超时的 fetch
const fetchWithTimeout = async (url, options, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeoutMs}ms)`);
    }
    throw error;
  }
};
const fetchWithRetries = async (url, options, maxRetries = 3) => {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      console.error(`请求失败(尝试 ${i+1}/${maxRetries}):`, error);
      lastError = error;

      if (i < maxRetries - 1) {
        // 指数退避
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};

// 简单的哈希函数，用于识别重复问题
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // 转换为32位整数
  }
  return hash;
}

function useChatApi(sessionId, setSessionId) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingRequests] = useState(new Map());
  const [streamFailureCount, setStreamFailureCount] = useState(0);

  // 监控流式失败计数并处理
  useEffect(() => {
    // 如果流式传输多次失败，暂时禁用它
    if (streamFailureCount > 3) {
      console.log("流式传输多次失败，暂时禁用流式模式");
      localStorage.setItem("disableStreaming", "true");
      // 5分钟后重置
      setTimeout(() => {
        localStorage.removeItem("disableStreaming");
        setStreamFailureCount(0);
      }, 5 * 60 * 1000);
    }
  }, [streamFailureCount]);

  // 发起初始请求，获取requestId或直接获取答案
  const initiateRequest = useCallback(async (question, useStream = false) => {
    console.log(`发起请求: sessionId=${sessionId}, useStream=${useStream}, 问题长度=${question.length}`);

    // 检查是否暂时禁用流式传输
    const shouldDisableStreaming = localStorage.getItem("disableStreaming") === "true";
    if (shouldDisableStreaming && useStream) {
      console.log("由于之前的失败，流式传输已暂时禁用");
      useStream = false;
    }

    try {
      // 创建问题的哈希值以识别重复请求
      const questionHash = hashString(question);

      // 检查是否已经在处理这个问题
      if (pendingRequests.has(questionHash)) {
        console.log("这个问题的请求已在进行中");
        return { inProgress: true };
      }

      // 添加到待处理请求
      pendingRequests.set(questionHash, true);

      try {
        // 判断是否是简单问题
        const isSimpleQuestion = question.length < 50 &&
                                !question.includes("如何") &&
                                !question.includes("为什么") &&
                                !question.includes("比较");

        const normalizedQuestion = question.toLowerCase().trim();

        // 检查是否是简单问候语
        if (GREETING_CACHE[normalizedQuestion] && !useStream) {
          return {
            directAnswer: true,
            answer: GREETING_CACHE[normalizedQuestion]
          };
        }

        let retries = 0;
        const maxRetries = 2;
        let lastError = null;

        while (retries < maxRetries) {
          try {
            console.log(`尝试请求 ${retries + 1}/${maxRetries}...`);
            const response = await fetchWithTimeout(`${API_URL}/rag-background`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
              },
              body: JSON.stringify({
                question,
                sessionId: sessionId,
                preferFastResponse: isSimpleQuestion && !useStream,
                stream: useStream
              })
            }, 30000); // 30秒超时

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`服务器错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            console.log("API响应收到:", Object.keys(data));

            if (data.sessionId) {
              console.log(`更新会话ID: ${data.sessionId}`);
              setSessionId(data.sessionId);
            }

            if (data.answer) {
              console.log("收到后端直接回答");
              return {
                directAnswer: true,
                answer: data.answer
              };
            }

            if (data.streamConfig) {
              console.log("收到流式配置:", {
                hasEndpoint: !!data.streamConfig.apiEndpoint,
                hasApiKey: !!data.streamConfig.apiKey,
                model: data.streamConfig.model
              });
              return {
                directAnswer: false,
                streamConfig: data.streamConfig,
                requestId: data.requestId
              };
            }

            if (data.quickResponse) {
              console.log("收到快速响应");
              return {
                directAnswer: false,
                quickResponse: data.quickResponse,
                requestId: data.requestId
              };
            }

            if (data.fallbackToStandard) {
              console.log("不支持流式响应，回退到标准处理");
              return initiateRequest(question, false);
            }

            console.log(`收到请求ID: ${data.requestId}`);
            return {
              directAnswer: false,
              requestId: data.requestId,
              sessionId: data.sessionId || sessionId
            };
          } catch (error) {
            lastError = error;
            retries++;
            console.warn(`请求尝试${retries}失败: ${error.message}`);

            if (retries < maxRetries) {
              const delay = Math.pow(2, retries) * 1000;
              console.log(`${delay}ms后重试...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        throw lastError || new Error('所有请求尝试均失败');
      } finally {
        // 处理完毕后从待处理请求中移除
        pendingRequests.delete(questionHash);
      }
    } catch (error) {
      console.error('初始化请求失败:', error);
      throw error;
    }
  }, [pendingRequests, sessionId, setSessionId]);

    // 更新流式处理后的会话
  const updateSessionAfterStreaming = useCallback(async (sessionId, question, answer) => {
    try {
      console.log("更新流式处理后的会话:", sessionId);

      const response = await fetchWithTimeout(`${API_URL}/status-background`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          updateSession: true,
          sessionId: sessionId,
          question: question,
          answer: answer
        })
      }, 15000); // 15秒超时

      const data = await response.json();
      console.log("会话更新响应:", data);

      console.log("流式处理后会话已更新");
      return true;
    } catch (error) {
      console.error("更新流式处理后会话失败:", error);
      return false;
    }
  }, []);

  // 处理流式响应
  const handleStreamingResponse = useCallback(async (streamConfig, onMessageUpdate) => {
    try {
      console.log("设置流式连接...");

      // 验证流式配置
      if (!streamConfig || !streamConfig.apiEndpoint || !streamConfig.model || !streamConfig.apiKey) {
        console.error("无效的流式配置:", JSON.stringify({
          ...streamConfig,
          apiKey: streamConfig && streamConfig.apiKey ? "[REDACTED]" : undefined
        }, null, 2));
        throw new Error("流式配置无效，无法建立连接");
      }

      // 调试信息
      console.log("流式配置详情:", {
        endpoint: streamConfig.apiEndpoint,
        model: streamConfig.model,
        messageCount: streamConfig.messages?.length || 0
      });

      // 创建请求体
      const requestBody = {
        model: streamConfig.model,
        messages: streamConfig.messages || [{ role: "user", content: "请提供回答" }],
        stream: true,
        temperature: streamConfig.parameters?.temperature || 0.7,
        max_tokens: streamConfig.parameters?.max_tokens || 2048,
        top_p: streamConfig.parameters?.top_p || 0.9
      };

      // 创建fetch选项
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${streamConfig.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      };

      // 发送请求
      console.log("发送流式请求到:", streamConfig.apiEndpoint);
      const response = await fetchWithTimeout(streamConfig.apiEndpoint, options, 60000); // 60秒超时

      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text();
        console.error("流式API错误响应:", errorText);
        throw new Error(`API返回错误状态: ${response.status}`);
      }

      console.log("流式连接已建立，开始读取...");

      // 设置流式读取器
      const reader = response.body.getReader();
      console.log("Stream connection details:", {
        responseOK: response.ok,
        bodyAvailable: !!response.body,
        statusCode: response.status
      });
      const decoder = new TextDecoder("utf-8");
      let fullResponse = '';

      // 处理流式数据
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log("流式传输完成");
          break;
        }

        // 解码数据块
        const chunk = decoder.decode(value);
        console.log("接收到数据块，大小:", chunk.length);

        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();

            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                const content = parsed.choices[0].delta.content;
                fullResponse += content;

                // 更新UI
                onMessageUpdate(fullResponse);
              }
            } catch (parseError) {
              console.warn("无法解析流式数据块:", parseError.message);
            }
          }
        }
      }

      console.log("流式处理成功完成");

      // 更新会话历史
      const userQuestion = streamConfig.messages.find(m => m.role === 'user')?.content || '';
      await updateSessionAfterStreaming(sessionId, userQuestion, fullResponse);
      console.log("Updated message with content length:", fullResponse.length);

      // 成功时重置失败计数
      setStreamFailureCount(0);

      return fullResponse;
    } catch (error) {
      console.error("Streaming error details:", {
        message: error.message,
        stack: error.stack,
        streamConfig: {
          hasEndpoint: !!streamConfig?.apiEndpoint,
          hasKey: !!streamConfig?.apiKey,
          hasModel: !!streamConfig?.model
        }
      });
      setStreamFailureCount(prev => prev + 1);
      return false;
    }
  }, [sessionId, updateSessionAfterStreaming]);



  // 改进版的轮询函数
  const pollForResult = useCallback(async (requestId, sessionId, attempts = 0) => {
    // Don't attempt to poll with an invalid sessionId
    if (!sessionId || sessionId === "null") {
      console.log("Cannot poll without valid session ID");
      return {
        status: "error",
        error: "No valid session ID available"
      };
    }

    console.log(`轮询中: requestId=${requestId}, sessionId=${sessionId}, attempts=${attempts}`);

    try {
      // 超出最大尝试次数时停止
      if (attempts >= MAX_POLL_ATTEMPTS) {
        console.log(`达到最大轮询次数${MAX_POLL_ATTEMPTS}`);
        return {
          status: "timeout",
          requestId: requestId,
          message: "处理时间较长，请稍后检查结果。"
        };
      }

      console.log(`正在轮询请求ID: ${requestId}, 会话ID: ${sessionId}, 尝试次数: ${attempts + 1}`);

      // 尝试不同的请求方法来提高成功率
      let result = null;
      let success = false;

      // 方法 1: 使用 JSON 格式的 POST 请求，设置明确的 Content-Type
      try {
        console.log("尝试方法 1: JSON POST");
        const response = await fetchWithTimeout(`${API_URL}/status-background`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify({
            requestId: requestId,
            sessionId: sessionId
          })
        }, 10000); // 10秒超时

        if (response.ok) {
          result = await response.json();
          success = true;
          console.log("方法 1 成功");
        }
      } catch (error) {
        console.log("方法 1 失败:", error.message);
      }

      // 方法 2: 使用 URLSearchParams 作为 POST 请求体
      if (!success) {
        try {
          console.log("尝试方法 2: URLSearchParams POST");
          const params = new URLSearchParams();
          params.append('requestId', requestId);
          params.append('sessionId', sessionId);

          const response = await fetchWithTimeout(`${API_URL}/status-background`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Cache-Control': 'no-cache'
            },
            body: params
          }, 10000); // 10秒超时

          if (response.ok) {
            result = await response.json();
            success = true;
            console.log("方法 2 成功");
          }
        } catch (error) {
          console.log("方法 2 失败:", error.message);
        }
      }

      // 如果所有尝试都失败
      if (!success) {
        throw new Error("所有请求方法都失败");
      }

      // 处理成功的结果
      if (result.status === 'completed' && result.answer) {
        console.log("收到回答:", result.answer.substring(0, 50) + "...");
        return result;
      } else if (result.status === 'failed') {
        console.error("请求失败:", result.error);
        return {
          status: "error",
          error: result.error || "处理请求时出错"
        };
      } else {
        // 继续轮询
        console.log(`状态: ${result.status}，等待${POLL_INTERVAL}ms后重试`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        // 修复：确保传递sessionId到轮询函数中
        return pollForResult(requestId, sessionId, attempts + 1);
      }
    } catch (error) {
      console.error("轮询错误:", error);
      // 增加重试次数
      if (attempts < MAX_POLL_ATTEMPTS - 1) {
        console.log(`轮询出错，${POLL_INTERVAL}ms后重试...`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        // 修复：确保传递sessionId到轮询函数中
        return pollForResult(requestId, sessionId, attempts + 1);
      }
      // 如果达到最大重试次数，返回超时状态
      return {
        status: "timeout",
        requestId: requestId,
        message: "处理时间较长，请稍后检查结果。"
      };
    }
  }, []);

  // 检查特定请求的答案 - 修复为使用sessionId
  const checkAnswer = useCallback(async (requestId) => {
    if (!requestId) return null;

    try {
      // 修复：传递sessionId而非0
      const result = await pollForResult(requestId, sessionId, 0);
      return result;
    } catch (error) {
      console.error("检查答案失败:", error);
      return {
        status: "error",
        error: `检查失败: ${error.message}`
      };
    }
  }, [pollForResult, sessionId]); // 添加sessionId到依赖数组

  return {
    initiateRequest,
    handleStreamingResponse,
    pollForResult,
    checkAnswer,
    isProcessing,
    setIsProcessing,
    streamFailureCount
  };
}

export default useChatApi;