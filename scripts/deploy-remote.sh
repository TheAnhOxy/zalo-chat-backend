#!/usr/bin/env bash
# Chạy trên EC2 sau git pull (GitHub Actions hoặc tay).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$BACKEND_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: Thiếu $BACKEND_DIR/.env trên EC2. Tạo file .env trước khi deploy."
  exit 1
fi

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

if pm2 describe quickchat-api >/dev/null 2>&1; then
  echo "==> pm2 restart quickchat-api"
  pm2 restart quickchat-api
else
  echo "==> pm2 start quickchat-api"
  pm2 start dist/main.js --name quickchat-api
fi

pm2 save
echo "==> Deploy xong."
