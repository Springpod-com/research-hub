#!/usr/bin/env bash
# Production entrypoint: one process group on the Reserved VM.
# 1. The app: Express serves dist/, /api and the research worker on $PORT.
# 2. ClamAV daemon as a sidecar for upload scanning (fails closed if absent),
#    started only once the app is answering. Loading its signatures takes the
#    VM's CPU and about 1 GB of memory for up to a minute; when that overlapped
#    the app's own start-up, the platform's 60-second port check failed and
#    the VM was restarted in a loop. Uploads are refused until clamd is ready.
#    Memory is shared with the app (the VM ran on 2 GB until 2026-09-17, 8 GB
#    since): see scripts/clamav/clamav-daemon.sh for why the scanner must
#    never hold two copies of its signatures at once.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=production
if [ "${CLAMAV_SIDECAR:-on}" = "off" ]; then
  echo "[start] CLAMAV_SIDECAR=off: uploads stay disabled unless UPLOAD_SCAN_COMMAND points at another scanner"
elif command -v clamd >/dev/null 2>&1; then
  (
    app=$$ # this shell becomes the app below (exec), so its PID is the app's
    port="${PORT:-3001}"
    for _ in $(seq 1 180); do
      (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break
      sleep 1
    done
    echo "[start] app is listening on $port; starting the ClamAV sidecar"
    # Low priority so signature loads and reloads do not slow down requests.
    nice -n 10 scripts/clamav/clamav-daemon.sh &
    sidecar=$!
    # If the app is killed or crashes, take the scanner down with it: a
    # leftover clamd would hold a gigabyte of memory and slow the next start.
    while kill -0 "$app" 2>/dev/null && kill -0 "$sidecar" 2>/dev/null; do
      sleep 5
    done
    kill "$sidecar" 2>/dev/null || true
    wait "$sidecar" 2>/dev/null || true
  ) &
else
  echo "[start] clamd is not installed; uploads stay disabled" >&2
fi
exec node_modules/.bin/tsx server/index.ts
