export const getApiUrl = () => {
  // 获取当前域名
  const domain = window.location.origin;
  // 构建绝对路径 API URL
  return `${domain}/.netlify/functions`;
};