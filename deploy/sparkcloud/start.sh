#!/bin/sh
# Bogey, all in one, without Docker: every service runs under /srv/bogey/run/supervise.sh.
# Logs: /srv/bogey/logs; control: bogeyctl status | restart <svc> | logs <svc>.
exec /srv/bogey/run/supervise.sh
