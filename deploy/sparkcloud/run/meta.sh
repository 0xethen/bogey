#!/bin/bash
# Studio only: Debian 12 image with native addons, so it runs under proot
. /srv/bogey/run/common.sh
wait_db
export PG_META_HOST=127.0.0.1 PG_META_PORT=8080 PG_META_DB_HOST=db PG_META_DB_PORT=5432 PG_META_DB_NAME=postgres
export PG_META_DB_USER=postgres PG_META_DB_PASSWORD=$POSTGRES_PASSWORD CRYPTO_KEY=$PG_META_CRYPTO_KEY NODE_ENV=production
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec proot -r /srv/img/meta -b /proc -b /dev -b /sys -b /etc/hosts -b /etc/resolv.conf -w /usr/src/app \
  node dist/server/server.js
