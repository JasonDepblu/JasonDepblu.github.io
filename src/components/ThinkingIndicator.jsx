import React, { useEffect, useRef } from 'react';

function ThinkingIndicator({ id, text = 'thinking', attempts = 0 }) {
  const intervalRef = useRef(null);
  const dotsRef = useRef(null);

  // 根据轮询次数选择不同的提示文本
  const thinkingTexts = [
    'thinking',
    '搜索知识库中',
    '整理回答中',
    '正在生成回答',
    '即将完成'
  ];

  const currentText = thinkingTexts[Math.min(Math.floor(attempts / 6), thinkingTexts.length - 1)];

  // 动画效果
  useEffect(() => {
    let count = 0;

    intervalRef.current = setInterval(() => {
      if (dotsRef.current) {
        count = (count + 1) % 4;
        dotsRef.current.textContent = '.'.repeat(count);
      }
    }, 500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <div id={id} className="ai-message thinking">
      <p>
        {text || currentText}
        <span ref={dotsRef} className="dots">...</span>
      </p>
    </div>
  );
}

export default ThinkingIndicator;
