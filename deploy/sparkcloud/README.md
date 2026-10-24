# Bogey on SparkCloud

The all-in-one stack without Docker, for a SparkCloud box. The guide is
[docs/self-hosting/sparkcloud.md](../../docs/self-hosting/sparkcloud.md).

| File                | What it is                                                              |
| ------------------- | ----------------------------------------------------------------------- |
| `install.sh`        | sets up a fresh box: images, Postgres, `.env`, the scripts below        |
| `start.sh`          | `/app/start.sh`, which SparkCloud runs on every boot                    |
| `run/supervise.sh`  | runs each service in a restart loop; logs in `/srv/bogey/logs`          |
| `run/<service>.sh`  | one per compose service, with the compose's environment                 |
| `run/Caddyfile`     | the front door and the gateway (Kong's routes and key checks)           |
| `run/bogeyctl`      | `status`, `start`, `stop`, `restart`, `logs`, `upgrade`                 |
| `run/bogey-upgrade` | moves to a release, builds plugins and themes in, rolls back on failure |
| `run/bogey`         | the CLI with `.env` loaded                                              |

`bogey-upgrade` installs these from the release it moves to, so change them
here, not on the box. Service images are the ones `deploy/all-in-one/compose.yml`
pins.
