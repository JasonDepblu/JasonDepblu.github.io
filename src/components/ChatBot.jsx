// src/components/ChatBot.jsx
import React, { useState, useEffect, useCallback } from 'react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import StreamToggle from './StreamToggle';
import useLocalStorage from '../hooks/useLocalStorage';
import useChatApi from '../hooks/useChatApi';

function ChatBot() {
  // 状态管理
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useLocalStorage('chatSessionId', null);
  const [useStream, setUseStream] = useState(true);
  const [thinking, setThinking] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // 使用自定义Hook进行API通信
  const {
    initiateRequest,
    handleStreamingResponse,
    pollForResult,
    checkAnswer,
    streamFailureCount
  } = useChatApi(sessionId, setSessionId);

  // 处理流式响应失败时的UI反馈
  useEffect(() => {
    if (streamFailureCount >= 3 && useStream) {
      setUseStream(false);
      addMessage('ai', '已自动关闭流式响应模式，因为检测到多次连接失败。', false, true);
    }
  }, [streamFailureCount, useStream]);

  // 添加消息到聊天记录
  const addMessage = useCallback((type, content, isStreaming = false, error = false) => {
    setMessages(prev => [...prev, { type, content, isStreaming, error }]);
  }, []);

  // 更新流式消息内容
  const updateStreamMessage = useCallback((content) => {
    console.log("Updating stream message, content length:", content.length);
    setMessages(prev => {
      const newMessages = [...prev];
      const lastIndex = newMessages.length - 1;

      if (lastIndex >= 0 && newMessages[lastIndex].isStreaming) {
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          content
        };
      }

      return newMessages;
    });
  }, []);

  // 检查特定请求的结果
  const handleCheckAnswer = useCallback(async (requestId) => {
    const thinkingId = 'checking-' + Date.now();
    setThinking({
      id: thinkingId,
      text: '检查结果中'
    });
    setIsProcessing(true);

    try {
      const result = await checkAnswer(requestId);
      setThinking(null);
      handleResult(result);
    } catch (error) {
      setThinking(null);
      addMessage('ai', `检查失败: ${error.message}`, false, true);
    } finally {
      setIsProcessing(false);
    }
  }, [addMessage, checkAnswer]);

  // 处理API结果 - 修复版本
  // 3. src/components/ChatBot.jsx - 修改handleResult部分
  const handleResult = useCallback((result) => {
    if (result.status === "timeout") {
      // 超时但仍在处理 - 使用结构化对象而非HTML字符串
      addMessage('ai', {
        type: 'processing-message',
        message: result.message,
        requestId: result.requestId
      }, false, false);
      return;
    }
    console.log(`处理结果: status=${result.status}, hasAnswer=${!!result.answer}`);

    if (result.answer) {
      // 更新会话ID
      if (result.sessionId) {
        setSessionId(result.sessionId);
      }

      // 渲染回答
      addMessage('ai', result.answer);
    } else if (result.status === "error") {
      // 处理错误
      addMessage('ai', result.error || '处理完成，但没有获得回答', false, true);
    } else {
      // 没有回答
      addMessage('ai', '处理完成，但没有获得回答', false, true);
    }
  }, [addMessage, setSessionId]);

  const pollWithThinkingUpdates = useCallback(async (requestId, sessionId) => {
    let attempts = 0;
    let pollResult;

    do {
      // 更新思考状态
      setThinking(prev => ({
        ...prev,
        attempts: attempts
      }));

      // 执行轮询
      pollResult = await pollForResult(requestId, sessionId, attempts);
      attempts++;

      // 如果完成或失败，退出循环
      if (pollResult.status === 'completed' || pollResult.status === 'failed' ||
          pollResult.status === 'error' || pollResult.status === 'timeout') {
        break;
      }

      // 等待下一次轮询
      await new Promise(resolve => setTimeout(resolve, 2000));
    } while (attempts < 30); // 避免无限循环

    return pollResult;
  }, [pollForResult]);

  // 处理用户发送的消息
  const handleSendMessage = useCallback(async (question) => {
    if (!question.trim()) return;

    // 禁用输入，显示处理状态
    setIsProcessing(true);

    // 添加用户消息到UI
    addMessage('user', question);

    // 添加"思考中"的提示
    const thinkingId = 'thinking-' + Date.now();
    setThinking({
      id: thinkingId,
      attempts: 0
    });

    try {
      console.log(`发送问题: ${question}`);
      const result = await initiateRequest(question, useStream);
      console.log("initiateRequest 结果:", {
        directAnswer: result.directAnswer,
        hasStreamConfig: !!result.streamConfig,
        requestId: result.requestId,
        sessionId: result.sessionId
      });

      // 更新会话ID
      if (result.sessionId) {
        setSessionId(result.sessionId);
        console.log(`更新会话ID: ${result.sessionId}`);
      }

      // 1. 处理直接回答
      if (result.directAnswer) {
        console.log("收到直接回答");
        setThinking(null);
        addMessage('ai', result.answer);
        return;
      }

      if (result.streamConfig) {
        console.log("流式配置详情:", {
          hasEndpoint: !!result.streamConfig?.apiEndpoint,
          hasApiKey: !!result.streamConfig?.apiKey,
          model: result.streamConfig?.model,
          messagesCount: result.streamConfig?.messages?.length
        });
      }

      // 2. 处理流式响应
      if (result.streamConfig && useStream) {
        console.log("开始流式响应处理");
        setThinking(null);

        // 添加初始流式消息
        addMessage('ai', '', true);

        // 开始流式传输
        const streamResult = await handleStreamingResponse(
          result.streamConfig,
          updateStreamMessage
        );

        if (streamResult !== false) {
            // Update the message to mark it as no longer streaming
          setMessages(prev => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;

            if (lastIndex >= 0 && newMessages[lastIndex].isStreaming) {
              newMessages[lastIndex] = {
                ...newMessages[lastIndex],
                isStreaming: false  // Set streaming to false
              };
            }

          return newMessages;
          });
        }

        // 如果流式传输失败，回退到轮询
        if (streamResult === false) {
          console.log("流式传输失败，回退到轮询");
          if (result.requestId && result.sessionId) {
            const pollResult = await pollForResult(result.requestId, result.sessionId, 0);
            handleResult(pollResult);
          }
        }
        return;
      }

      // 3. 标准轮询处理
      if (result.requestId && result.sessionId) {
        console.log(`开始轮询结果: ${result.requestId}`);

        // 更新思考状态以显示不同的文本
        let attempts = 0;
        const pollWithUpdatingThinking = async () => {
          setThinking(prev => ({
            ...prev,
            attempts: attempts
          }));

          const pollResult = await pollForResult(result.requestId, result.sessionId, attempts);
          attempts++;

          return pollResult;
        };

        const pollResult = await pollWithUpdatingThinking();
        setThinking(null);
        handleResult(pollResult);
      } else {
        console.error("缺少必要的ID:", {
          hasRequestId: !!result.requestId,
          hasSessionId: !!result.sessionId
        });
        setThinking(null);
        addMessage('ai', '无法获取请求ID或会话ID，请重试', false, true);
      }
    } catch (err) {
      // 移除思考中状态
      setThinking(null);
      console.error('处理失败:', err);
      addMessage('ai', `获取回答失败: ${err.message}`, false, true);
    } finally {
      // 恢复输入状态
      setIsProcessing(false);
    }
  }, [
    addMessage,
    handleResult,
    handleStreamingResponse,
    initiateRequest,
    pollForResult,
    updateStreamMessage,
    useStream,
    setSessionId
  ]);

  // 清除会话
  const handleClearSession = useCallback(() => {
    if (window.confirm('确定要开始新的对话吗？这将清除当前的对话历史。')) {
      localStorage.removeItem('chatSessionId');
      setSessionId(null);
      setMessages([]);
      addMessage('ai', '已开始新的对话。');
    }
  }, [addMessage, setSessionId]);

  // 切换流式响应模式
  const handleToggleStream = useCallback((e) => {
    setUseStream(e.target.checked);
  }, []);

  return (
    <div id="chat-container">
      <MessageList
        messages={messages}
        thinking={thinking}
        checkAnswerHandler={handleCheckAnswer}
      />

      <ChatInput
        onSendMessage={handleSendMessage}
        disabled={isProcessing}
      />

      <div className="controls">
        <StreamToggle
          checked={useStream}
          onChange={handleToggleStream}
        />

        <button
          id="clear-session"
          onClick={handleClearSession}
          title="开始新的对话，清除对话历史"
        >
          新对话
        </button>
      </div>
    </div>
  );
}

export default ChatBot;