// netlify/functions/shared-background/session_store.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Check if we're in a production environment
const isProduction = process.env.NODE_ENV === 'production';

// 调试信息
console.log(`Current environment: ${isProduction ? 'production' : 'development'}`);
// 会话存储文件路径
const SESSIONS_FILE = path.join('/tmp', 'sessions.json');
console.log(`Session file path: ${SESSIONS_FILE}`);

// 内存中的会话缓存
let sessionsCache = {};
let lastLoadTime = 0;

// 生成会话ID助手函数
function generateSessionId() {
  return crypto.randomUUID();
}

// 从文件加载会话 - 增加了错误处理
function loadSessions() {
  try {
    // 检查自上次加载后是否已经过了1秒
    const now = Date.now();
    if (now - lastLoadTime < 1000 && Object.keys(sessionsCache).length > 0) {
      return sessionsCache; // 使用缓存
    }

    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      try {
        const parsed = JSON.parse(data);
        // 更新缓存和时间戳
        sessionsCache = parsed;
        lastLoadTime = now;
        return parsed;
      } catch (parseError) {
        console.error('Error parsing sessions JSON:', parseError);
        // 如果解析失败但缓存有数据，则返回缓存
        if (Object.keys(sessionsCache).length > 0) {
          return sessionsCache;
        }
        return {};
      }
    } else {
      console.log(`Sessions file not found at ${SESSIONS_FILE}, creating new empty sessions`);
      return {};
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
    // 如果文件访问失败但缓存有数据，则返回缓存
    if (Object.keys(sessionsCache).length > 0) {
      return sessionsCache;
    }
    return {};
  }
}

// 保存会话到文件 - 增加了错误处理和重试逻辑
function saveSessions(sessions) {
  try {
    // 确保目录存在
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 更新缓存
    sessionsCache = sessions;

    // 写入文件
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving sessions:', error);

    // 尝试简单的重试
    try {
      console.log('Retrying session save with simple format...');
      // 尝试用更简单的格式保存
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
      return true;
    } catch (retryError) {
      console.error('Retry failed:', retryError);
      return false;
    }
  }
}

// 初始化内存中的会话缓存
try {
  sessionsCache = loadSessions();
  console.log(`Loaded ${Object.keys(sessionsCache).length} sessions into cache`);
} catch (initError) {
  console.error('Failed to initialize sessions:', initError);
  sessionsCache = {};
}

// 导出会话存储接口
module.exports = {
  // 获取会话 - 优先从缓存读取
  getSession(sessionId) {
    if (!sessionId) return null;

    // 先检查缓存
    if (sessionsCache[sessionId]) {
      return sessionsCache[sessionId];
    }

    // 如果缓存中没有，从文件加载
    const currentSessions = loadSessions();
    return currentSessions[sessionId] || null;
  },

  // 设置会话
  setSession(sessionId, data) {
    if (!sessionId) {
      sessionId = generateSessionId();
    }

    // 先获取当前会话
    const currentSessions = loadSessions();
    currentSessions[sessionId] = data;

    // 保存并更新缓存
    saveSessions(currentSessions);
    sessionsCache[sessionId] = data;

    return { sessionId, data };
  },

  // 更新会话特定字段
  updateSession(sessionId, key, value) {
    if (!sessionId) return null;

    // 获取当前会话
    const currentSessions = loadSessions();

    // 如果会话不存在，创建新会话
    if (!currentSessions[sessionId]) {
      currentSessions[sessionId] = {};
    }

    // 更新字段
    currentSessions[sessionId][key] = value;

    // 保存并更新缓存
    saveSessions(currentSessions);
    sessionsCache[sessionId] = currentSessions[sessionId];

    return currentSessions[sessionId];
  },

  // 获取所有会话
  getAllSessions() {
    return loadSessions();
  },

  // 清理过期会话
  cleanupSessions(maxAgeHours = 24) {
    try {
      const currentSessions = loadSessions();
      const now = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      let cleanupCount = 0;

      // 遍历所有会话，删除过期的
      for (const sessionId in currentSessions) {
        const session = currentSessions[sessionId];
        const created_at = session.created_at || 0;

        if (now - created_at > maxAgeMs) {
          delete currentSessions[sessionId];
          cleanupCount++;
        }
      }

      if (cleanupCount > 0) {
        console.log(`Cleaned up ${cleanupCount} expired sessions`);
        saveSessions(currentSessions);
      }

      return { success: true, cleanupCount };
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
      return { success: false, error: error.message };
    }
  }
};