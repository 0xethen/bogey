#!/bin/bash
. /srv/bogey/run/common.sh
export PATH=$PGBIN:/usr/lib/postgresql/bin:$PATH
export PGDATA=/var/lib/postgresql/data POSTGRES_HOST=/var/run/postgresql POSTGRES_USER=supabase_admin POSTGRES_DB=postgres
export POSTGRES_INITDB_ARGS="--allow-group-access --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8"
export LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8 GRN_PLUGINS_DIR=/usr/lib/groonga/plugins
export LOCALE_ARCHIVE=/nix/var/nix/profiles/default/lib/locale/locale-archive
export PGPORT=5432 POSTGRES_PORT=5432 PGPASSWORD=$POSTGRES_PASSWORD PGDATABASE=postgres JWT_EXP=$JWT_EXPIRY
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
exec docker-entrypoint.sh postgres -D /etc/postgresql -c config_file=/etc/postgresql/postgresql.conf \
  -c log_min_messages=fatal -c max_parallel_workers_per_gather=0 -c max_parallel_maintenance_workers=0 -c listen_addresses=127.0.0.1
