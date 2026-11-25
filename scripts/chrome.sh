#!/usr/bin/env bash
# Manage the isolated Osmosis Chrome. Usage: scripts/chrome.sh start|reload|stop
cd "$(dirname "$0")/.."
LOG=/var/tmp/osmosis-launcher.log
pid() { pgrep -f "node scripts/launch-chrome\.cjs" | head -1; }
case "$1" in
  start)
    [ -n "$(pid)" ] && { echo "already running"; exit 0; }
    nohup node scripts/launch-chrome.cjs "$PWD/dist/extension" > "$LOG" 2>&1 &
    for i in $(seq 1 40); do grep -q "\[launcher\] ready\|exited" "$LOG" 2>/dev/null && break; sleep 0.5; done
    grep "\[launcher\]" "$LOG" ;;
  reload)
    P=$(pid); [ -z "$P" ] && { echo "not running"; exit 1; }
    kill -USR2 "$P"; sleep 2; grep "\[launcher\]" "$LOG" | tail -2 ;;
  stop)
    pkill -KILL -f "user-data-dir=/var/tmp/osmosis-chrom[e]"; sleep 1; echo stopped ;;
esac
