#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export HARNESS_AUTH_MODE="${HARNESS_AUTH_MODE:-development}"
exec "${AGENT_PYTHON:-/d/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe}" -m uvicorn app.main:app --host 127.0.0.1 --port "${AGENT_PORT:-17820}"
