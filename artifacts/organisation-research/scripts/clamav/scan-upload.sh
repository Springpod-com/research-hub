#!/usr/bin/env bash
# UPLOAD_SCAN_COMMAND adapter. The app runs `<command> --no-summary -` and
# pipes the uploaded bytes to standard input. Exit codes follow clamdscan:
# 0 clean, 1 threat found, 2 scanner unavailable (the app answers 503).
RUN_DIR="${CLAMAV_RUN_DIR:-/tmp/organisation-research-clamav}"
exec clamdscan --config-file="$RUN_DIR/clamd.conf" "$@"
