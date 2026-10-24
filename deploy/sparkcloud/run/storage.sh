#!/bin/bash
. /srv/bogey/run/common.sh
wait_db
R=/srv/img/storage
mkdir -p /srv/bogey/data/storage
export ANON_KEY SERVICE_KEY=$SERVICE_ROLE_KEY POSTGREST_URL=http://127.0.0.1:3002 AUTH_JWT_SECRET=$JWT_SECRET
export DATABASE_URL=postgres://supabase_storage_admin:$POSTGRES_PASSWORD@db:5432/postgres
export STORAGE_PUBLIC_URL=$SUPABASE_PUBLIC_URL REQUEST_ALLOW_X_FORWARDED_PATH=true FILE_SIZE_LIMIT=${STORAGE_FILE_SIZE_LIMIT:-52428800}
export STORAGE_BACKEND=file GLOBAL_S3_BUCKET=stub FILE_STORAGE_BACKEND_PATH=/srv/bogey/data/storage TENANT_ID=stub REGION=stub
export ENABLE_IMAGE_TRANSFORMATION=false S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET
export SERVER_HOST=127.0.0.1 SERVER_PORT=5000 HOST=127.0.0.1 PORT=5000 NODE_ENV=production
cd $R/app
exec $R/lib/ld-musl-x86_64.so.1 --library-path $R/lib:$R/usr/lib:$R/usr/local/lib $R/usr/local/bin/node dist/start/server.js
