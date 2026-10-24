# Sourced by each service script: the instance's .env and a wait helper.
set -a; . /srv/bogey/.env; set +a
JWT_EXPIRY=${JWT_EXPIRY:-3600}
PGBIN=/nix/var/nix/profiles/default/bin
export PATH=$PGBIN:$PATH

wait_db() { until $PGBIN/pg_isready -q -h 127.0.0.1 -p 5432 -U postgres -d postgres; do sleep 2; done; }
wait_http() { until curl -fsS -o /dev/null "$1"; do sleep 2; done; }
