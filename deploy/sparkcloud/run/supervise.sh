#!/bin/bash
# Runs every service in a restart loop; logs in /srv/bogey/logs, pids in /run/bogey.
SERVICES=${*:-"db auth rest realtime storage web caddy meta studio"}
mkdir -p /srv/bogey/logs /run/bogey
grep -q " db auth " /etc/hosts || echo "127.0.0.1 db auth rest kong web storage realtime-dev.supabase-realtime host.docker.internal" >> /etc/hosts

loop() {
  local s=$1 log=/srv/bogey/logs/$1.log
  while true; do
    [ -f "$log" ] && [ "$(stat -c %s "$log")" -gt 20000000 ] && mv "$log" "$log.1"
    echo "[$(date -Is)] starting $s" >> "$log"
    /srv/bogey/run/$s.sh >> "$log" 2>&1 &
    echo $! > /run/bogey/$s.pid
    wait $!; rc=$?
    echo "[$(date -Is)] $s exited ($rc)" >> "$log"
    sleep 3
  done
}
for s in $SERVICES; do loop $s & done
wait
