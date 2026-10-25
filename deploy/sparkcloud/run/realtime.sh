#!/bin/bash
. /srv/bogey/run/common.sh
wait_db
export PORT=4000 DB_HOST=db DB_PORT=5432 DB_USER=supabase_admin DB_PASSWORD=$POSTGRES_PASSWORD DB_NAME=postgres
export DB_AFTER_CONNECT_QUERY="SET search_path TO _realtime" DB_ENC_KEY=$REALTIME_DB_ENC_KEY
export API_JWT_SECRET=$JWT_SECRET SECRET_KEY_BASE METRICS_JWT_SECRET=$JWT_SECRET
# two schedulers of each kind instead of one per core and ten for IO: threads count against the box's cap
export ERL_AFLAGS="-proto_dist inet_tcp +S 2:2 +SDcpu 2:2 +SDio 2"
export DNS_NODES="''" APP_NAME=realtime SEED_SELF_HOST=true RUN_JANITOR=true
# the all-in-one's limits; the seed applies them to a new tenant, and the update to an existing one
export TENANT_MAX_CONCURRENT_USERS=${REALTIME_MAX_CONNECTIONS:-500} TENANT_MAX_JOINS_PER_SECOND=${REALTIME_MAX_JOINS_PER_SECOND:-250}
export TENANT_MAX_EVENTS_PER_SECOND=${REALTIME_MAX_EVENTS_PER_SECOND:-500}
PGPASSWORD=$POSTGRES_PASSWORD psql -q -h 127.0.0.1 -U supabase_admin -d postgres -c "update _realtime.tenants
  set max_concurrent_users = $TENANT_MAX_CONCURRENT_USERS, max_joins_per_second = $TENANT_MAX_JOINS_PER_SECOND,
    max_events_per_second = $TENANT_MAX_EVENTS_PER_SECOND" 2>/dev/null || true
export DISABLE_HEALTHCHECK_LOGGING=true ECTO_IPV6=false MIX_ENV=prod LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export ERL_CRASH_DUMP=/tmp/erl_crash.dump PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec proot -r /srv/img/realtime -b /proc -b /dev -b /sys -b /etc/hosts -b /etc/resolv.conf -w /app \
  /bin/bash -c 'ulimit -Sn 10000; /app/bin/migrate && /app/bin/realtime eval "Realtime.Release.seeds(Realtime.Repo)" && exec /app/bin/server'
