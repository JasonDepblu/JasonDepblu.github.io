import { useState, useEffect } from 'react';

function useLocalStorage(key, initialValue) {
  // 读取localStorage中的值，如果不存在则使用初始值
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error('从本地存储获取数据失败:', error);
      return initialValue;
    }
  });

  // 当存储的值变化时更新localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error('保存到本地存储失败:', error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

export default useLocalStorage;