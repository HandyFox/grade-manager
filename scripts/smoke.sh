#!/usr/bin/env bash
# Runs the automated UI walk-through and saves screenshots to $GM_SMOKE_OUT (default /tmp/gm-smoke).
# Linux: needs xvfb-run.  Usage: scripts/smoke.sh [path/to/Grade_Manager.xltm]
set -e
cd "$(dirname "$0")/.."
export GM_SMOKE=1
export GM_SMOKE_OUT="${GM_SMOKE_OUT:-/tmp/gm-smoke}"
[ -n "$1" ] && export GM_SMOKE_IMPORT="$(realpath "$1")"
rm -rf "$GM_SMOKE_OUT"
mkdir -p "$GM_SMOKE_OUT"
if command -v xvfb-run >/dev/null && [ -z "$DISPLAY" ]; then
  xvfb-run -a -s "-screen 0 1600x1000x24" npx electron . --no-sandbox
else
  npx electron .
fi
echo "Screenshots in $GM_SMOKE_OUT"
