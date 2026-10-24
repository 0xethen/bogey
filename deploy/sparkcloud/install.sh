#!/bin/bash
# install.sh: Bogey all-in-one on a fresh SparkCloud box, without Docker.
#   apt-get update && apt-get install -y curl
#   curl -fsSL https://raw.githubusercontent.com/0xethen/bogey/main/deploy/sparkcloud/install.sh \
#     | bash -s -- --host bogey.example.org
# Options: --host <host>[,<host>...] (required; the first is the main one), --tag <version> (default:
# the newest release). Every service of deploy/all-in-one/compose.yml runs from its image's files,
# under /srv/bogey/run/supervise.sh. See docs/self-hosting/sparkcloud.md.
set -euo pipefail

REPO=ghcr.io/0xethen/bogey
SOURCE=https://codeload.github.com/0xethen/bogey/tar.gz/refs/tags
CRANE=v0.20.6
PROOT=v5.5.0
IMG=/srv/img
HOME_DIR=/srv/bogey
RUN=$HOME_DIR/run

bold=$'\e[1m' red=$'\e[31m' green=$'\e[32m' off=$'\e[0m'
step() { echo "${bold}==>${off} $*"; }
ok() { echo "  ${green}✓${off} $*"; }
die() { echo "  ${red}✗${off} $*" >&2; exit 1; }

HOSTS="" TAG=""
while [ $# -gt 0 ]; do
  case $1 in
    --host) HOSTS=${2:-}; shift 2 ;;
    --tag) TAG=${2#v}; shift 2 ;;
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option $1 (try --help)" ;;
  esac
done
[ -n "$HOSTS" ] || die "pass --host <your host>"
[ "$(id -u)" = 0 ] || die "run this as root"
[ -e "$RUN/supervise.sh" ] && die "Bogey is already installed here; upgrade it with bogey-upgrade"

# SparkCloud sleeps the box after a quiet spell, and SSH doesn't count; requests through its proxy do
(while true; do
  for h in $(echo "$HOSTS" | tr ',' ' '); do curl -s -o /dev/null --max-time 20 "https://$h/" || true; done
  sleep 45
done) &
KEEPALIVE=$!
trap 'kill $KEEPALIVE 2>/dev/null' EXIT

step "Tools"
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils procps iproute2 less jq >/dev/null
curl -fsSL "https://github.com/google/go-containerregistry/releases/download/$CRANE/go-containerregistry_Linux_x86_64.tar.gz" \
  | tar xz -C /usr/local/bin crane
# Ubuntu's proot 5.1 doesn't translate statx, which node in the studio and meta images needs
TMP=$(mktemp -d)
curl -fsSL -o "$TMP/proot" "https://github.com/proot-me/proot/releases/download/$PROOT/proot"
curl -fsSL -o "$TMP/SHA256SUMS" "https://github.com/proot-me/proot/releases/download/$PROOT/SHA256SUMS"
(cd "$TMP" && grep ' proot$' SHA256SUMS | sha256sum -c --quiet) || die "proot's checksum doesn't match"
install -m 755 "$TMP/proot" /usr/local/bin/proot
ok "crane $CRANE, proot $PROOT"

if [ -z "$TAG" ]; then
  TAG=$(crane ls "$REPO" | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -V | tail -1)
  [ -n "$TAG" ] || die "couldn't list the releases of $REPO"
fi
DIGEST=$(crane digest --platform linux/amd64 "$REPO:$TAG") || die "there's no $REPO:$TAG"

step "Bogey $TAG's deploy files"
SRC=$TMP/src && mkdir -p "$SRC"
curl -fsSL "$SOURCE/v$TAG" | tar -xz -C "$SRC" --strip-components=1 --wildcards '*/deploy/*'
[ -f "$SRC/deploy/sparkcloud/run/supervise.sh" ] || die "$TAG has no deploy/sparkcloud; pass --tag with a newer release"
COMPOSE=$SRC/deploy/all-in-one/compose.yml
image() { grep -oE "image: *$1:[^ ]+" "$COMPOSE" | head -1 | sed 's/image: *//'; }
ok "from v$TAG"

step "Images (about 3.5 GB)"
mkdir -p "$IMG"
export_to() { mkdir -p "$IMG/$1" && crane export --platform linux/amd64 "$2" - | tar -x -C "$IMG/$1" --no-same-owner; }
export_to db "$(image supabase/postgres)" &
export_to auth "$(image supabase/gotrue)" &
export_to rest "$(image postgrest/postgrest)" &
export_to realtime "$(image supabase/realtime)" &
wait
export_to storage "$(image supabase/storage-api)" &
export_to caddy "$(image caddy)" &
export_to meta "$(image supabase/postgres-meta)" &
export_to studio "$(image supabase/studio)" &
export_to web "$REPO@$DIGEST" &
wait
for svc in db auth rest realtime storage caddy meta studio web; do
  [ -n "$(ls -A "$IMG/$svc")" ] || die "couldn't export the $svc image"
done
ok "in $IMG"

step "Postgres"
cd "$IMG/db"
cp -a nix /nix
cp -a etc/postgresql etc/postgresql-custom /etc/
mkdir -p /usr/lib/postgresql /usr/share/postgresql
cp -a usr/lib/postgresql/. /usr/lib/postgresql/
cp -a usr/share/postgresql/. /usr/share/postgresql/
cp -a usr/lib/groonga /usr/lib/
cp -a docker-entrypoint-initdb.d /
cp usr/local/bin/docker-entrypoint.sh usr/local/bin/gosu /usr/local/bin/
getent group postgres >/dev/null || groupadd -r postgres
id postgres >/dev/null 2>&1 || useradd -r -g postgres -d /var/lib/postgresql -s /bin/bash postgres
mkdir -p /var/lib/postgresql /var/run/postgresql
chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql /etc/postgresql /etc/postgresql-custom
V=$SRC/deploy/all-in-one/volumes/db
cp "$V/realtime.sql" /docker-entrypoint-initdb.d/migrations/99-realtime.sql
cp "$V/webhooks.sql" /docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql
cp "$V/roles.sql" /docker-entrypoint-initdb.d/init-scripts/99-roles.sql
cp "$V/jwt.sql" /docker-entrypoint-initdb.d/init-scripts/99-jwt.sql
cd /
ok "the image's Nix build, run natively"

step "Box scripts"
mkdir -p "$HOME_DIR"/{logs,state,themes,backups,data}
cp -a "$SRC/deploy/sparkcloud/run" "$RUN"
[ -f /app/start.sh ] && [ ! -f /app/start.sh.orig ] && cp -a /app/start.sh /app/start.sh.orig
mkdir -p /app && install -m 755 "$SRC/deploy/sparkcloud/start.sh" /app/start.sh
cp /srv/img/web/usr/local/bin/node /usr/local/bin/node
ln -sfn "$IMG/web/opt/bogey" /opt/bogey
ln -sfn "$RUN/bogey" /usr/local/bin/bogey
ln -sfn "$RUN/bogeyctl" /usr/local/bin/bogeyctl
ln -sfn "$RUN/bogey-upgrade" /usr/local/bin/bogey-upgrade
# bogey.config.ts imports @bogey/config, which only resolves inside the app folder
ln -sfn "$IMG/web/app/bogey.config.ts" "$HOME_DIR/bogey.config.ts"
echo "$DIGEST" >"$HOME_DIR/state/web.digest"
echo "$TAG" >"$HOME_DIR/state/web.version"
[ -f "$IMG/web/app/bogey.plugins.lock" ] || echo '{}' >"$IMG/web/app/bogey.plugins.lock"
cp "$IMG/web/app/bogey.plugins.lock" "$HOME_DIR/state/plugins.lock"
: >"$HOME_DIR/state/themes.sum"
ok "in $RUN; /app/start.sh runs them on every boot"

step "Secrets (.env)"
cp -a "$SRC/deploy/all-in-one/.env.example" "$SRC/deploy/all-in-one/volumes" "$HOME_DIR/"
(cd "$HOME_DIR" && BOGEY_HOME=$IMG/web/app BOGEY_CONFIG=$IMG/web/app/bogey.config.ts \
  node /opt/bogey/cli/bin.mjs setup --all-in-one --host "$HOSTS" --out "$HOME_DIR")
# the scripts source .env with the shell, so values with spaces need quotes
sed -i -E 's/^(CADDY_SITES)=([^"].* .*)$/\1="\2"/' "$HOME_DIR/.env"
sed -i "s|^BOGEY_IMAGE=.*|BOGEY_IMAGE=$REPO:$TAG|" "$HOME_DIR/.env"
ok "$HOME_DIR/.env"

step "Starting"
# SparkCloud's placeholder page holds :80 until Caddy takes over
for pid in $(ss -Hltnp 'sport = :80' 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill "$pid" || true; done
setsid /app/start.sh >/dev/null 2>&1 </dev/null &
for _ in $(seq 1 150); do
  curl -s -o /dev/null --max-time 5 http://127.0.0.1:3000/ && break
  sleep 2
done
curl -s -o /dev/null --max-time 5 http://127.0.0.1:3000/ || die "web didn't come up; see bogeyctl status and bogeyctl logs web 100"
rm -rf "$TMP"
ok "every service is up (bogeyctl status)"

MAIN=${HOSTS%%,*}
echo
echo "${green}${bold}Bogey $TAG is running.${off} Next, make the organization:"
echo "  bogey org init --org <slug> --name \"<Name>\" --owner <you@example.org> --host $MAIN --app-url http://web:3000"
echo "Then set SMTP in $HOME_DIR/.env (quote values with spaces) and run bogeyctl restart auth web."
