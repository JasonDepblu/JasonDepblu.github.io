export const getApiUrl = () => {
  // 检测是否在本地开发环境
  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

  if (isLocalDev) {
    // 本地开发环境：Netlify Functions 运行在 9999 端口
    // 使用当前页面的 hostname 以避免跨域问题
    const hostname = window.location.hostname;
    return `http://${hostname}:9999/.netlify/functions`;
  }

  // 生产环境：使用当前域名
  const domain = window.location.origin;
  return `${domain}/.netlify/functions`;
};