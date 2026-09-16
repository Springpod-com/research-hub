#!/usr/bin/env bash
# Production entrypoint: one process group on the Reserved VM.
# 1. ClamAV daemon as a sidecar for upload scanning (fails closed if absent).
# 2. The app: Express serves dist/, /api and the research worker on $PORT.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${CLAMAV_SIDECAR:-on}" = "off" ]; then
  echo "[start] CLAMAV_SIDECAR=off: uploads stay disabled unless UPLOAD_SCAN_COMMAND points at another scanner"
elif command -v clamd >/dev/null 2>&1; then
  scripts/clamav/clamav-daemon.sh &
else
  echo "[start] clamd is not installed; uploads stay disabled" >&2
fi
export NODE_ENV=production
exec node_modules/.bin/tsx server/index.ts
