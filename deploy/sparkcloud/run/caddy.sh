#!/bin/bash
. /srv/bogey/run/common.sh
export XDG_CONFIG_HOME=/srv/bogey/data/caddy XDG_DATA_HOME=/srv/bogey/data/caddy
exec /srv/img/caddy/usr/bin/caddy run --config /srv/bogey/run/Caddyfile --adapter caddyfile
