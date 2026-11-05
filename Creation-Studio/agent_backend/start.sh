#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export HARNESS_AUTH_MODE="${HARNESS_AUTH_MODE:-controller}"
# 优先用智能体自己的 venv；没有再退回历史共用的 ml-engineer 环境兜底
if [ -z "${AGENT_PYTHON:-}" ] && [ -x ".venv/Scripts/python.exe" ]; then
  AGENT_PYTHON=".venv/Scripts/python.exe"
fi
AGENT_PYTHON="${AGENT_PYTHON:-/d/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe}"
exec "$AGENT_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "${AGENT_PORT:-17820}"
