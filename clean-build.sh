#!/bin/bash
# clean-build.sh

echo "=== Cleaning up old files ==="
rm -rf _site
rm -rf build

echo "=== Building Jekyll site ==="
JEKYLL_ENV=production bundle exec jekyll build --trace

echo "=== Building React app ==="
PUBLIC_URL=/chat npm run build

echo "=== Integrating React with Jekyll ==="
mkdir -p _site/chat
cp -r build/static _site/chat/

# Verify the files exist
echo "=== Verifying build ==="
if [ -f "_site/index.html" ]; then
  echo "✅ _site/index.html exists"
else
  echo "❌ _site/index.html is missing!"
fi

if [ -f "_site/chat/index.html" ]; then
  echo "✅ _site/chat/index.html exists"
else
  echo "❌ _site/chat/index.html is missing!"
fi

echo "=== Build complete ==="