#!/bin/bash
. /srv/bogey/run/common.sh
wait_db
wait_http http://127.0.0.1:9999/health
wait_http http://127.0.0.1:5000/status
bogey db migrate && bogey plugins migrate || exit 1
export BOGEY_PASSKEY_HOST=$BOGEY_HOST BOGEY_TRUST_PROXY=1 BOGEY_APP_URL=http://web:3000 SMTP_PORT=${SMTP_PORT:-587}
# reach Supabase through Caddy on this box, not out through SparkCloud's proxy and back
export SUPABASE_INTERNAL_URL=http://127.0.0.1
export UV_THREADPOOL_SIZE=2 NODE_OPTIONS=--v8-pool-size=2
export NODE_ENV=production HOST=0.0.0.0 PORT=3000 BOGEY_HOME=/srv/img/web/app BOGEY_CONFIG=/srv/img/web/app/bogey.config.ts
cd /srv/img/web/app
exec node server/index.mjs
