import React, { useState, useEffect, useRef } from 'react';

function ChatInput({ onSendMessage, disabled }) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef(null);

  // 自动调整文本区域高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  // 处理提交
  const handleSubmit = (e) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');

      // 重置文本区域高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  // 处理键盘事件
  const handleKeyDown = (e) => {
    // Ctrl+Enter 或 在移动设备上直接 Enter 发送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div id="input-area">
      <textarea
        ref={textareaRef}
        id="question"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="请输入您的问题..."
        // disabled={disabled}
      />
      <button
        id="send-btn"
        onClick={handleSubmit}
        disabled={!message.trim() || disabled}
      >
        {disabled ? '处理中...' : '提交'}
      </button>
    </div>
  );
}

export default ChatInput;