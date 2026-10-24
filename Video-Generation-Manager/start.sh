#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if [ ! -d node_modules/playwright-core ]; then
  npm ci --no-audit --no-fund
fi
exec node src/server.js --open
