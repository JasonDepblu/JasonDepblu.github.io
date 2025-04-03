#!/bin/bash

echo "=== 提取Jekyll的头部和尾部 ==="

# 创建临时目录
TMP_DIR="_tmp_integration"
mkdir -p "$TMP_DIR"
HEADER_FILE="$TMP_DIR/header.html"
FOOTER_FILE="$TMP_DIR/footer.html"

# 提取头部（兼容 macOS）
perl -ne 'print if /<header/../<\/header>/' _site/index.html > "$HEADER_FILE" 2>/dev/null || {
  echo "<!-- Header not found -->" > "$HEADER_FILE"
  echo "⚠️ 未找到 Jekyll 头部，使用默认占位符"
}

# 提取尾部（兼容 macOS）
perl -ne 'print if /<footer/../<\/footer>/' _site/index.html > "$FOOTER_FILE" 2>/dev/null || {
  echo "<!-- Footer not found -->" > "$FOOTER_FILE"
  echo "⚠️ 未找到 Jekyll 尾部，使用默认占位符"
}

echo "=== 将Jekyll布局注入React构建 ==="

# 使用 perl 进行多行注入（彻底绕过 sed 的兼容性问题）
{
  # 注入头部到 <body> 标签后
  perl -pi -e 's|<body>|$&'"$(cat $HEADER_FILE)"'|g' build/index.html

  # 注入尾部到 </body> 标签前
  perl -pi -e 's|</body>|'"$(cat $FOOTER_FILE)"'$&|g' build/index.html
} || {
  echo "❌ 注入失败，请检查临时文件内容"
  exit 1
}

echo "=== 集成React到Jekyll网站 ==="
mkdir -p _site/chat
cp -r build/* _site/chat/

# 清理临时文件
rm -rf "$TMP_DIR"

# 验证复制结果
if [ -d "_site/chat/static" ]; then
  echo "✅ static folder copied successfully"
else
  echo "❌ static folder copy failed"
fi

echo "=== Dev integration 完成 ==="
