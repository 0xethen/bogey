#!/bin/bash
# Localhost only; reach it with ssh -L 54323:127.0.0.1:54323
. /srv/bogey/run/common.sh
wait_http http://127.0.0.1:8080/health
export HOSTNAME=127.0.0.1 PORT=${STUDIO_PORT:-54323} STUDIO_PG_META_URL=http://127.0.0.1:8080
export POSTGRES_PORT=5432 POSTGRES_HOST=db POSTGRES_DB=postgres POSTGRES_PASSWORD POSTGRES_USER_READ_WRITE=postgres
export PG_META_CRYPTO_KEY PGRST_DB_SCHEMAS=public DEFAULT_ORGANIZATION_NAME=Bogey DEFAULT_PROJECT_NAME=Bogey
export SUPABASE_URL=http://127.0.0.1:80 SUPABASE_PUBLIC_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_KEY=$SERVICE_ROLE_KEY
export AUTH_JWT_SECRET=$JWT_SECRET ENABLED_FEATURES_LOGS_ALL=false NODE_ENV=production
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec proot -r /srv/img/studio -b /proc -b /dev -b /sys -b /etc/hosts -b /etc/resolv.conf -w /app \
  node apps/studio/server.js
