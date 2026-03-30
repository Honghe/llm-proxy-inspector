#!/usr/bin/env bash

set -euo pipefail

UPSTREAM_BASE="${UPSTREAM_BASE:-http://192.168.0.9:8080}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
PROXY_PORT="${PROXY_PORT:-7654}"
FRONTEND_PORT="${FRONTEND_PORT:-7655}"
DB_PATH="${DB_PATH:-data/proxy.db}"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the frontend." >&2
  exit 1
fi

pushd frontend >/dev/null
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run build
popd >/dev/null

python3 backend/app.py \
  --upstream "${UPSTREAM_BASE}" \
  --host "${BACKEND_HOST}" \
  --proxy-port "${PROXY_PORT}" \
  --db-path "${DB_PATH}" &
BACKEND_PID=$!

python3 frontend/server.py \
  --host "${FRONTEND_HOST}" \
  --port "${FRONTEND_PORT}" &
FRONTEND_PID=$!

wait "${BACKEND_PID}" "${FRONTEND_PID}"
