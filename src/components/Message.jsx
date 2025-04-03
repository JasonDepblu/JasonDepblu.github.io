// Message.jsx 改进
import React from 'react';
import { marked } from 'marked';

function Message({ type, content, isStreaming = false, error = false, checkAnswerHandler = null }) {
  // 渲染Markdown内容
  const renderContent = () => {
    // 检查是否是带有检查按钮的特殊消息对象
    if (content && typeof content === 'object' && content.type === 'processing-message') {
      return (
        <div className="processing-message">
          <p>{content.message}</p>
          <button
            onClick={() => checkAnswerHandler && checkAnswerHandler(content.requestId)}
            className="check-button"
          >
            检查是否已完成
          </button>
        </div>
      );
    }

    // 正常的字符串内容
    if (typeof content === 'string') {
      try {
        // 对AI消息使用Markdown渲染
        if (type === 'ai' && !error) {
          return <div dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />;
        }
      } catch (e) {
        console.error('Markdown渲染错误:', e);
      }
    }

    // 默认情况或渲染失败时直接显示文本
    return <p>{content}</p>;
  };

  const className = `${type}-message ${isStreaming ? 'streaming' : ''} ${error ? 'error-message' : ''}`;

  return (
    <div className={className}>
      {renderContent()}
      {isStreaming && <div className="stream-indicator">正在生成回答...</div>}
    </div>
  );
}

export default Message;