// 2. src/components/MessageList.jsx - 更新的消息列表组件
import React, { useEffect, useRef } from 'react';
import Message from './Message';
import ThinkingIndicator from './ThinkingIndicator';

function MessageList({ messages, thinking, checkAnswerHandler }) {
  const messagesEndRef = useRef(null);

  // 自动滚动到最新消息
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, thinking]);

  return (
    <div id="chat-log">
      {messages.map((msg, index) => (
        <Message
          key={index}
          type={msg.type}
          content={msg.content}
          isStreaming={msg.isStreaming}
          error={msg.error}
          checkAnswerHandler={checkAnswerHandler}
        />
      ))}

      {thinking && (
        <ThinkingIndicator
          id={thinking.id}
          text={thinking.text}
          attempts={thinking.attempts || 0}
        />
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

export default MessageList;