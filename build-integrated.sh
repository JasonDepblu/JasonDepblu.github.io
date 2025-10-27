##!/bin/bash
#
#echo "=== 提取Jekyll的头部和尾部 ==="
#
## 创建临时目录
#TMP_DIR="_tmp_integration"
#mkdir -p "$TMP_DIR"
#HEADER_FILE="$TMP_DIR/header.html"
#FOOTER_FILE="$TMP_DIR/footer.html"
#
## 提取头部（兼容 macOS）
#perl -ne 'print if /<header/../<\/header>/' _site/index.html > "$HEADER_FILE" 2>/dev/null || {
#  echo "<!-- Header not found -->" > "$HEADER_FILE"
#  echo "⚠️ 未找到 Jekyll 头部，使用默认占位符"
#}
#
## 提取尾部（兼容 macOS）
#perl -ne 'print if /<footer/../<\/footer>/' _site/index.html > "$FOOTER_FILE" 2>/dev/null || {
#  echo "<!-- Footer not found -->" > "$FOOTER_FILE"
#  echo "⚠️ 未找到 Jekyll 尾部，使用默认占位符"
#}
#
#echo "=== 将Jekyll布局注入React构建 ==="
#
## 使用 perl 进行多行注入（彻底绕过 sed 的兼容性问题）
#{
#  # 注入头部到 <body> 标签后
#  perl -pi -e 's|<body>|$&'"$(cat $HEADER_FILE)"'|g' build/index.html
#
#  # 注入尾部到 </body> 标签前
#  perl -pi -e 's|</body>|'"$(cat $FOOTER_FILE)"'$&|g' build/index.html
#} || {
#  echo "❌ 注入失败，请检查临时文件内容"
#  exit 1
#}
#
#echo "=== 集成React到Jekyll网站 ==="
#mkdir -p _site/chat
#cp -r build/* _site/chat/
#
## 清理临时文件
#rm -rf "$TMP_DIR"
#
## 验证复制结果
#if [ -d "_site/chat/static" ]; then
#  echo "✅ static folder copied successfully"
#else
#  echo "❌ static folder copy failed"
#fi
#
#echo "=== Dev integration 完成 ==="

#!/bin/bash
set -e

echo "=== 开始集成构建流程 ==="

#############################
# 1. 构建 Jekyll 网站
#############################
echo "=== 正在构建 Jekyll 网站 ==="
bundle exec jekyll build
echo "=== Jekyll 构建完成 ==="

#############################
# 2. 构建 React 应用
#############################
echo "=== 正在构建 React 应用 ==="
# 设置 React 打包后的 PUBLIC_URL（确保 React 路由中正确匹配 /chat 路径）
export PUBLIC_URL=/chat
npm run build
echo "=== React 应用构建完成 ==="

#############################
# 3. 提取 Jekyll 的头部和尾部
#############################
echo "=== 提取 Jekyll 的头部和尾部 ==="
TMP_DIR="_tmp_integration"
mkdir -p "$TMP_DIR"
HEADER_FILE="$TMP_DIR/header.html"
FOOTER_FILE="$TMP_DIR/footer.html"

# 从 Jekyll 构建的首页中提取 <header> 到 </header> 的内容
sed -n '/<header/,/<\/header>/p' _site/index.html > "$HEADER_FILE"
# 从 Jekyll 构建的首页中提取 <footer> 到 </footer> 的内容
sed -n '/<footer/,/<\/footer>/p' _site/index.html > "$FOOTER_FILE"

# 如果提取结果为空，则使用默认占位符
if [ ! -s "$HEADER_FILE" ]; then
  echo "<!-- Header not found -->" > "$HEADER_FILE"
  echo "⚠️ 未找到 Jekyll 头部，使用默认占位符"
fi
if [ ! -s "$FOOTER_FILE" ]; then
  echo "<!-- Footer not found -->" > "$FOOTER_FILE"
  echo "⚠️ 未找到 Jekyll 尾部，使用默认占位符"
fi

#############################
# 4. 将提取的头部和尾部注入到 React 构建的 index.html
#############################
echo "=== 注入头部和尾部到 React 构建的 index.html ==="
if [ ! -f build/index.html ]; then
  echo "Error: build/index.html 不存在，请检查 React 构建是否正确。"
  exit 1
fi

# 备份原始文件
cp build/index.html build/index.html.bak

# 读取文件内容到变量
REACT_HTML=$(cat build/index.html)
HEADER_HTML=$(cat "$HEADER_FILE")
FOOTER_HTML=$(cat "$FOOTER_FILE")

# 将 <body> 替换为 <body> 加上 header 内容
NEW_HTML=${REACT_HTML/<body>/<body>$HEADER_HTML}
# 将 </body> 替换为 footer 内容加上 </body>
NEW_HTML=${NEW_HTML/<\/body>/$FOOTER_HTML<\/body>}

# 将整合后的内容写回 index.html
echo "$NEW_HTML" > build/index.html

# 验证修改是否成功
if grep -q '<header' build/index.html && grep -q '<footer' build/index.html; then
  echo "✅ 成功注入头部和尾部"
else
  echo "❌ 注入失败，恢复备份"
  mv build/index.html.bak build/index.html
fi

#############################
# 5. 集成 React 构建结果到 Jekyll 网站
#############################
echo "=== 集成 React 应用到 Jekyll 网站中 ==="
# 创建 chat 目录用于存放 React 应用页面（chatbot 页面）
mkdir -p _site/chat
# 清空 _site/chat 目录（如果存在旧文件）
rm -rf _site/chat/*
# 复制 React 构建的所有文件到 _site/chat
cp -r build/* _site/chat/

echo "=== 集成构建流程完成 ==="
