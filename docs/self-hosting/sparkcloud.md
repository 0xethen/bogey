# SparkCloud

A SparkCloud box is an unprivileged Docker container
(Ubuntu 22.04, 4 CPU, 15 GB RAM, 15 GB disk), so Docker can't run inside it and
the [all-in-one compose](all-in-one.md) can't either. `deploy/sparkcloud` runs
the same services without Docker: each image's files are unpacked into
`/srv/img/<service>` and its process runs straight from them, under a small
supervisor in place of compose.

SparkCloud's proxy terminates TLS and forwards to port 80, where Caddy is both
the front door and the gateway (it stands in for Kong).

## Install

On a fresh box, as root:

```sh
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/0xethen/bogey/main/deploy/sparkcloud/install.sh \
  | bash -s -- --host bogey.example.org
```

`--host` takes a comma-separated list; the first is the main host. The box's
own `*.sparkden.cloud` name works as is; for your own domain, point an A record
at the box and SparkCloud's proxy serves TLS for it. `--tag 2.5.0` installs a
specific release.

Most of the install is downloading about 3.5 GB of images. Then make the
organization:

```sh
bogey org init --org acme --name "Acme Hacks" --owner you@acme.org \
  --host bogey.example.org --app-url http://web:3000
```

`--app-url http://web:3000` lets the database reach the app for queued email
and webhooks.

## Day to day

| Command                               | What it does                                |
| ------------------------------------- | ------------------------------------------- |
| `bogeyctl status`                     | each service: up, down, or stopped          |
| `bogeyctl restart auth web`           | restarts services (also `start` and `stop`) |
| `bogeyctl logs web 100`               | follows a service's log                     |
| `bogey-upgrade` (`bogeyctl upgrade`)  | moves to the newest release; see below      |
| `bogey <command>`                     | the CLI, with `.env` loaded                 |
| `ssh -N -L 54323:127.0.0.1:54323 ...` | Supabase Studio at http://localhost:54323   |

The files:

| Path                                                  | What it is                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `/srv/bogey/.env`                                     | secrets and hosts; `bogey setup --all-in-one` wrote it          |
| `/srv/bogey/bogey.config.ts`                          | a link to `/srv/img/web/app/bogey.config.ts`, the real file     |
| `/srv/bogey/themes/<key>.theme.css`                   | this instance's own themes                                      |
| `/srv/bogey/run/`                                     | one script per service, the supervisor, `bogeyctl`, `Caddyfile` |
| `/srv/bogey/logs/`                                    | one log per service, and the upgrade's                          |
| `/srv/bogey/backups/`                                 | the last three pre-upgrade backups                              |
| `/var/lib/postgresql/data`, `/srv/bogey/data/storage` | the database and uploaded files                                 |

`.env` is read by the shell, not by compose, so **quote any value with spaces**
in it (a Gmail app password in `SMTP_PASS`, or `CADDY_SITES` with several
hosts). After changing it, restart what reads it: `bogeyctl restart auth web`
for SMTP.

`bogey.config.ts` has to stay inside the app folder: it imports
`@bogey/config`, which only resolves from there.

## Upgrading

```sh
bogey-upgrade            # the newest release
bogey-upgrade 2.5.0      # a specific one
bogey-upgrade --check    # only say what it would do
bogey-upgrade --force    # rebuild even if nothing changed, or go back a version
```

It backs up the database and Storage, downloads the release, applies its
migrations, swaps the app in and restarts it. If the new app doesn't answer, it
puts the previous one back. It also installs the release's
`deploy/sparkcloud/run` scripts, so local edits to `/srv/bogey/run` are
replaced (the old copies are kept in `/srv/bogey/run.prev`).

It runs detached and keeps the box awake while it works, so a dropped SSH
session doesn't stop it. The log is `/srv/bogey/logs/upgrade.log`.

### Plugins and themes

Plugins and themes are compiled into the app, so the published image can't
carry ones it doesn't ship. When this instance has any, `bogey-upgrade` builds
the release on the box with them (a few minutes, under the Dockerfile's build
image) instead of using the image as is.

- **Plugins:** `bogey plugins add <key>` or `remove`, then `bogey-upgrade`.
- **Themes:** put `<key>.theme.css` in `/srv/bogey/themes` (written as in
  [Themes](themes.md)), set `brand.theme` to `<key>` in `bogey.config.ts`, then
  `bogey-upgrade`. A theme with a shipped theme's key replaces it.

Change both files together: `bogey.config.ts` naming a theme the running app
doesn't have stops the app from starting. While a build is under way, the old
app keeps running.

## Limits

- The box caps processes and threads at 200, and the services use about 150.
  The upgrade pauses Studio and pg-meta while it builds.
- SparkCloud sleeps the box after about 10 quiet minutes, and SSH traffic
  doesn't count. Requests to the site do. Anything long you start over SSH
  should curl the site every minute or so, as the installer and the upgrade do.
- There's no Docker, so there's no [challenges runner](runner-security.md):
  the challenges plugin can't judge code here.
