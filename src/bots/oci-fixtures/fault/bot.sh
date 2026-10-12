#!/bin/sh
case "$MODE" in
  timeout) sleep 30 ;;
  fork) while :; do /app/bot & done ;;
  write) echo denied > /etc/ott-write-check ;;
  network) wget -T 2 -qO- http://1.1.1.1/ || sleep 30 ;;
  output) while :; do printf '%4096s' x; done ;;
  memory) exec awk 'BEGIN { while (1) a = a "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }' ;;
  cpu) exec awk 'BEGIN { while (1) x += 1 }' ;;
  *) exit 64 ;;
esac
