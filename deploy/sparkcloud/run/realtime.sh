#!/bin/bash
. /srv/bogey/run/common.sh
wait_db
export PORT=4000 DB_HOST=db DB_PORT=5432 DB_USER=supabase_admin DB_PASSWORD=$POSTGRES_PASSWORD DB_NAME=postgres
export DB_AFTER_CONNECT_QUERY="SET search_path TO _realtime" DB_ENC_KEY=$REALTIME_DB_ENC_KEY
export API_JWT_SECRET=$JWT_SECRET SECRET_KEY_BASE METRICS_JWT_SECRET=$JWT_SECRET
export ERL_AFLAGS="-proto_dist inet_tcp" DNS_NODES="''" APP_NAME=realtime SEED_SELF_HOST=true RUN_JANITOR=true
export DISABLE_HEALTHCHECK_LOGGING=true ECTO_IPV6=false MIX_ENV=prod LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export ERL_CRASH_DUMP=/tmp/erl_crash.dump PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec proot -r /srv/img/realtime -b /proc -b /dev -b /sys -b /etc/hosts -b /etc/resolv.conf -w /app \
  /bin/bash -c 'ulimit -Sn 10000; /app/bin/migrate && /app/bin/realtime eval "Realtime.Release.seeds(Realtime.Repo)" && exec /app/bin/server'
