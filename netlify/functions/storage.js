/**
 * storage.js - 持久化存储模块
 *
 * 部署时，将这个文件放在 netlify/functions 目录下作为共享模块。
 * 所有函数都可以导入这个模块来访问共享存储。
 */

// 引入 node-fetch 用于发送请求
const fetch = require('node-fetch');

// 存储选项 - 您可以根据需要启用其中一个
const STORAGE_TYPE = 'FILE'; // 可选值: 'FILE', 'API'

// 文件存储配置 - 使用 Netlify 的 /tmp 目录存储数据
const FILE_STORAGE_PATH = '/tmp/request_data.json';
const fs = require('fs');

// API 存储配置 - 如果使用外部 API 存储（如 KV.REST）
const API_STORAGE_URL = process.env.STORAGE_API_URL || 'https://example.com/api/storage';
const API_STORAGE_KEY = process.env.STORAGE_API_KEY || 'your-api-key';

/**
 * 保存数据到存储
 * @param {string} key - 存储键
 * @param {object} data - 要存储的数据
 * @param {number} expirySeconds - 过期时间（秒）
 * @returns {Promise<boolean>} - 是否保存成功
 */
async function saveData(key, data, expirySeconds = 600) {
  try {
    // 添加过期时间
    const expiry = Date.now() + (expirySeconds * 1000);
    const storageData = {
      ...data,
      expiry
    };

    if (STORAGE_TYPE === 'FILE') {
      return await saveToFile(key, storageData);
    } else if (STORAGE_TYPE === 'API') {
      return await saveToAPI(key, storageData);
    }

    return false;
  } catch (error) {
    console.error(`保存数据失败 (${key}):`, error);
    return false;
  }
}

/**
 * 从存储获取数据
 * @param {string} key - 存储键
 * @returns {Promise<object|null>} - 存储的数据或 null
 */
async function getData(key) {
  try {
    let data;

    if (STORAGE_TYPE === 'FILE') {
      data = await getFromFile(key);
    } else if (STORAGE_TYPE === 'API') {
      data = await getFromAPI(key);
    }

    // 检查数据是否过期
    if (data && data.expiry && data.expiry < Date.now()) {
      // 数据已过期，删除并返回 null
      await deleteData(key);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`获取数据失败 (${key}):`, error);
    return null;
  }
}

/**
 * 从存储中删除数据
 * @param {string} key - 存储键
 * @returns {Promise<boolean>} - 是否删除成功
 */
async function deleteData(key) {
  try {
    if (STORAGE_TYPE === 'FILE') {
      return await deleteFromFile(key);
    } else if (STORAGE_TYPE === 'API') {
      return await deleteFromAPI(key);
    }

    return false;
  } catch (error) {
    console.error(`删除数据失败 (${key}):`, error);
    return false;
  }
}

// ---- 文件存储实现 ----

/**
 * 获取当前存储的所有数据
 * @returns {Promise<object>} - 所有存储的数据
 */
async function getStorageData() {
  try {
    if (!fs.existsSync(FILE_STORAGE_PATH)) {
      return {};
    }

    const data = await fs.promises.readFile(FILE_STORAGE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("读取存储文件失败:", error);
    return {};
  }
}

/**
 * 将数据写入文件
 * @param {object} data - 要写入的数据
 * @returns {Promise<boolean>} - 是否写入成功
 */
async function writeStorageData(data) {
  try {
    await fs.promises.writeFile(
      FILE_STORAGE_PATH,
      JSON.stringify(data, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    console.error("写入存储文件失败:", error);
    return false;
  }
}

/**
 * 保存数据到文件
 * @param {string} key - 存储键
 * @param {object} data - 要存储的数据
 * @returns {Promise<boolean>} - 是否保存成功
 */
async function saveToFile(key, data) {
  const storageData = await getStorageData();
  storageData[key] = data;
  return await writeStorageData(storageData);
}

/**
 * 从文件获取数据
 * @param {string} key - 存储键
 * @returns {Promise<object|null>} - 存储的数据或 null
 */
async function getFromFile(key) {
  const storageData = await getStorageData();
  return storageData[key] || null;
}

/**
 * 从文件删除数据
 * @param {string} key - 存储键
 * @returns {Promise<boolean>} - 是否删除成功
 */
async function deleteFromFile(key) {
  const storageData = await getStorageData();
  if (key in storageData) {
    delete storageData[key];
    return await writeStorageData(storageData);
  }
  return true;
}

/**
 * 清理过期的文件存储数据
 * @returns {Promise<number>} - 清理的数据数量
 */
async function cleanupFileStorage() {
  try {
    const storageData = await getStorageData();
    const now = Date.now();
    let cleanCount = 0;

    for (const key in storageData) {
      if (storageData[key].expiry && storageData[key].expiry < now) {
        delete storageData[key];
        cleanCount++;
      }
    }

    if (cleanCount > 0) {
      await writeStorageData(storageData);
      console.log(`已清理 ${cleanCount} 条过期数据`);
    }

    return cleanCount;
  } catch (error) {
    console.error("清理过期数据失败:", error);
    return 0;
  }
}

// ---- API 存储实现 ----

/**
 * 保存数据到 API
 * @param {string} key - 存储键
 * @param {object} data - 要存储的数据
 * @returns {Promise<boolean>} - 是否保存成功
 */
async function saveToAPI(key, data) {
  try {
    const response = await fetch(`${API_STORAGE_URL}/${key}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_STORAGE_KEY}`
      },
      body: JSON.stringify(data)
    });

    return response.ok;
  } catch (error) {
    console.error(`API存储保存失败 (${key}):`, error);
    return false;
  }
}

/**
 * 从 API 获取数据
 * @param {string} key - 存储键
 * @returns {Promise<object|null>} - 存储的数据或 null
 */
async function getFromAPI(key) {
  try {
    const response = await fetch(`${API_STORAGE_URL}/${key}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_STORAGE_KEY}`
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`API存储获取失败 (${key}):`, error);
    return null;
  }
}

/**
 * 从 API 删除数据
 * @param {string} key - 存储键
 * @returns {Promise<boolean>} - 是否删除成功
 */
async function deleteFromAPI(key) {
  try {
    const response = await fetch(`${API_STORAGE_URL}/${key}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${API_STORAGE_KEY}`
      }
    });

    return response.ok;
  } catch (error) {
    console.error(`API存储删除失败 (${key}):`, error);
    return false;
  }
}

// 定期清理过期数据
async function cleanupStorage() {
  if (STORAGE_TYPE === 'FILE') {
    return await cleanupFileStorage();
  }
  // API 存储通常由服务提供商自动清理
  return 0;
}

// 导出函数
module.exports = {
  saveData,
  getData,
  deleteData,
  cleanupStorage
};