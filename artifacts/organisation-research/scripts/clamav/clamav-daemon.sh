#!/usr/bin/env bash
# ClamAV daemon for upload scanning (paired with scan-upload.sh).
#
# - Signatures live in $CLAMAV_DB_DIR (default: <app>/.data/clamav/db) and are
#   downloaded with freshclam on first start, then refreshed four times a day
#   by a background freshclam that tells clamd to reload.
# - clamd listens on a Unix socket in $CLAMAV_RUN_DIR (default:
#   /tmp/organisation-research-clamav), which scan-upload.sh connects to.
# - Runs in the foreground; exits non-zero if no signatures could be obtained.
#   The app fails closed: uploads are refused while the daemon is unavailable.
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN_DIR="${CLAMAV_RUN_DIR:-/tmp/organisation-research-clamav}"
DB_DIR="${CLAMAV_DB_DIR:-$PWD/.data/clamav/db}"
mkdir -p "$RUN_DIR" "$DB_DIR"

cat > "$RUN_DIR/freshclam.conf" <<EOF
DatabaseDirectory $DB_DIR
DatabaseMirror database.clamav.net
UpdateLogFile $RUN_DIR/freshclam.log
PidFile $RUN_DIR/freshclam.pid
NotifyClamd $RUN_DIR/clamd.conf
Checks 4
Foreground yes
EOF

cat > "$RUN_DIR/clamd.conf" <<EOF
LocalSocket $RUN_DIR/clamd.sock
FixStaleSocket yes
DatabaseDirectory $DB_DIR
TemporaryDirectory $RUN_DIR
PidFile $RUN_DIR/clamd.pid
LogFile $RUN_DIR/clamd.log
LogTime yes
Foreground yes
SelfCheck 600
MaxFileSize 25M
StreamMaxLength 25M
MaxScanSize 100M
EOF

# A previous run that was killed rather than stopped can leave its clamd
# (about 1 GB of memory) and freshclam behind. Stop them before starting new
# ones; the PID file is trusted only if that PID is still the named program.
for name in clamd freshclam; do
  pid=$(cat "$RUN_DIR/$name.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && [ "$(cat "/proc/$pid/comm" 2>/dev/null)" = "$name" ]; then
    echo "[clamav] stopping leftover $name (pid $pid) from a previous run"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  fi
  rm -f "$RUN_DIR/$name.pid"
done

if ! ls "$DB_DIR"/main.c?d >/dev/null 2>&1; then
  echo "[clamav] downloading virus signatures into $DB_DIR (first start)"
  freshclam --config-file="$RUN_DIR/freshclam.conf" || true
fi
if ! ls "$DB_DIR"/main.c?d >/dev/null 2>&1; then
  echo "[clamav] no signatures available; uploads stay disabled" >&2
  exit 1
fi

# Periodic signature updates; clamd reloads through NotifyClamd.
freshclam --config-file="$RUN_DIR/freshclam.conf" --daemon &

echo "[clamav] starting clamd on $RUN_DIR/clamd.sock"
exec clamd --config-file="$RUN_DIR/clamd.conf"
