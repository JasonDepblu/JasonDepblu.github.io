// src/utils/path-utils.js
export function jekyllToReactPath(jekyllPath) {
  // 移除前导斜杠来适配 React Router
  return jekyllPath.replace(/^\/chat\//, '/').replace(/\/$/, '') || '/';
}

export function reactToJekyllPath(reactPath) {
  // 添加前导斜杠和尾随斜杠来适配 Jekyll
  return `/${reactPath}`.replace(/\/{2,}/g, '/').replace(/\/?$/, '/');
}