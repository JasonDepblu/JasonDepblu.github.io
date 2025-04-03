#!/bin/bash

echo "=== 提取Jekyll的头部和尾部 ==="

# 创建临时目录
TMP_DIR="_tmp_integration"
mkdir -p "$TMP_DIR"
HEADER_FILE="$TMP_DIR/header.html"
FOOTER_FILE="$TMP_DIR/footer.html"

# 提取头部和尾部
sed -n '/<header/,/<\/header>/p' _site/index.html > "$HEADER_FILE"
sed -n '/<footer/,/<\/footer>/p' _site/index.html > "$FOOTER_FILE"

echo "=== 检查提取结果 ==="
if [ ! -s "$HEADER_FILE" ]; then
  echo "<!-- Header not found -->" > "$HEADER_FILE"
  echo "⚠️ 未找到 Jekyll 头部，使用默认占位符"
fi

if [ ! -s "$FOOTER_FILE" ]; then
  echo "<!-- Footer not found -->" > "$FOOTER_FILE"
  echo "⚠️ 未找到 Jekyll 尾部，使用默认占位符"
fi

echo "=== 将Jekyll布局注入React构建 ==="

# 保存原始文件
cp build/index.html build/index.html.bak

# 读取文件内容到变量
REACT_HTML=$(cat build/index.html)
HEADER_HTML=$(cat "$HEADER_FILE")
FOOTER_HTML=$(cat "$FOOTER_FILE")

# 使用字符串替换而非行号操作
# 替换 <body> 为 <body> + header
NEW_HTML=${REACT_HTML/<body>/<body>$HEADER_HTML}

# 替换 </body> 为 footer + </body>
NEW_HTML=${NEW_HTML/<\/body>/$FOOTER_HTML<\/body>}

# 将修改后的内容写回文件
echo "$NEW_HTML" > build/index.html

echo "=== 集成React到Jekyll网站 ==="
mkdir -p _site/chat
cp -r build/* _site/chat/

# 清理临时文件
rm -rf "$TMP_DIR"

# 验证修改
if grep -q '<header' build/index.html && grep -q '<footer' build/index.html; then
  echo "✅ 成功注入头部和尾部"
else
  echo "❌ 注入失败"
  # 恢复备份
  mv build/index.html.bak build/index.html
fi

echo "=== Dev integration 完成 ==="