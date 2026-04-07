#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATIC_PORT="${DEV_STATIC_PORT:-13131}"
STATIC_LOG="$ROOT_DIR/.wrangler/dev-static.log"

cd "$ROOT_DIR"

HUGO_VERSION="${HUGO_VERSION:-0.160.0}" bash ./scripts/build.sh

if curl -fsS --max-time 2 "http://127.0.0.1:${STATIC_PORT}/" >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$ROOT_DIR/.wrangler"
nohup python3 -m http.server "$STATIC_PORT" --bind 127.0.0.1 --directory public >"$STATIC_LOG" 2>&1 &