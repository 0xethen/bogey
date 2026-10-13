# Deploying with Docker

Bogey ships as one image: the web app, running Nitro's Node server as the
unprivileged `node` user. Supabase runs separately, either Supabase Cloud or
[Supabase's own self-hosted compose](https://supabase.com/docs/guides/self-hosting/docker).

## What's in the image

The build bakes in the themes and any installed plugins, so a fork builds its own image.
`bogey.config.ts` is baked in as a default and read again when the server starts, so the
compose files mount yours over it and changing it needs a restart, not a rebuild. Secrets are never baked in: the server reads
them at runtime, and hands the browser only `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`. One image works for any deployment.

## The CLI in the image

The image also has the `bogey` CLI and `psql`, so an instance that never checks out Bogey's source
can still run its operator commands:

```sh
docker compose exec web bogey doctor
docker compose exec web bogey db migrate && docker compose exec web bogey plugins migrate
docker compose exec web bogey org init --org acme --name "Acme Hacks" --owner you@acme.org
docker compose exec web bogey backup --out /tmp/backup
```

It reads the container's environment (the same `.env`), the migrations and installed plugins baked
into the image, and `/app/bogey.config.ts`. Commands that author Bogey (`db baseline`, `themes`,
`types`, `release`) need a checkout, and the ones that control the host (`upgrade`, `restart`,
`stop`) print what to run on the host instead. [The CLI reference](../reference/cli.md) says where
each command works.

## One organization, one hostname

```sh
vpr bogey setup             # writes .env at the repo root: Supabase and SMTP
BOGEY_HOST=bogey.example.org docker compose -f deploy/compose.yml up -d --build
```

Caddy gets and renews the certificate for `BOGEY_HOST` and proxies to the app.
Point the hostname's DNS at the server first. Then create the org with that
hostname (`bogey org init`, see [supabase.md](./supabase.md)).

## Many organizations

```sh
CADDYFILE=Caddyfile.hosted docker compose -f deploy/compose.yml up -d --build
```

Every org hostname (`alpha.bogey.example.app`, or a custom domain an org
points at you) gets its own certificate the first time someone visits.
Before issuing one, Caddy asks `/api/tls/ask`, which only says yes for
verified hostnames in `org_domains`. Point `*.bogey.example.app` and any
custom domains at the server. No DNS plugin or wildcard certificate is
needed.

## Reaching Supabase

`SUPABASE_URL` is used both by the server, inside the container, and by
visitors' browsers, so it must resolve and be reachable from both:

- **Supabase Cloud or a public hostname:** works as is.
- **Supabase on the same machine behind a hostname only the host resolves**
  (Tailscale MagicDNS, `/etc/hosts`): containers don't see it and every page
  fails with `getaddrinfo ENOTFOUND`. Give Supabase a hostname with public
  DNS, or map that hostname to the host with `extra_hosts` in
  `deploy/compose.yml`, as long as the host answers for it on the same port and
  certificate the browser uses.

## Restarting, stopping and what needs what

Bogey's web app never controls the host: there is no restart or stop button,
and the container has no access to Docker, on purpose. Those actions are the
operator's, from the shell:

```sh
bogey restart            # restart the app
bogey restart --build    # rebuild the image first: themes and plugins are part of the build
bogey stop               # stop it (--down also removes the containers)
```

(They run `docker compose -f deploy/compose.yml ...`; use that directly if you prefer.)
Plain `bogey` at a terminal opens a menu over the same commands.

| You changed                                                                | What it needs                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| Settings, email templates, org and event settings                          | Nothing; they apply immediately                  |
| `bogey.config.ts` (brand, repository, updates, security, disabled plugins) | Restart `web`                                    |
| Themes, installed plugins, logo files                                      | A rebuild: `bogey restart --build`               |
| `.env` (SMTP, keys)                                                        | Restart `web`                                    |
| GoTrue's environment (hook URL and secret, SMTP)                           | Restart the auth container                       |
| A new Bogey release                                                        | `bogey upgrade`, then rebuild (see upgrading.md) |

## Health

`/api/health` answers `{"ok":true}` without touching the database; the image's
`HEALTHCHECK` uses it. A page that fails while health passes usually means
the app can't reach Supabase: check `docker compose logs web`.

## Organizations and hostnames

```sh
bogey org list
bogey org create --org acme --name "Acme Hacks" --owner you@acme.org --host hacks.acme.org
bogey org domain add acme acme.example.app
bogey org domain remove old.acme.org
```

`org create` makes the owner an org owner, not a platform admin; the first
org on an instance comes from `bogey org init`. Hostnames added here count as
verified, so hosted mode issues their certificates on first visit.

## Backups

```sh
bogey backup --db-url "postgres://postgres:...@db-host:5432/postgres"
```

This writes `backups/<timestamp>/`, which is gitignored:

- `data.sql`: the data in `public`, `auth` and `storage`, dumped with `pg_dump`
  (install the PostgreSQL client tools matching your database's major version)
- `storage/<bucket>/...`: every uploaded file, fetched through the Storage API

To restore:

1. Apply `supabase/migrations` to a fresh Supabase.
2. Run `data.sql` with `psql`. Rows the migrations or Supabase already created
   are skipped.
3. Upload the `storage` folder.

Leave out `--db-url` to copy only files, for example on Supabase Cloud, where
daily database backups are built in.

## Limits and keeping orgs in check

Instance → Settings → Limits caps, per organization, events, owners and admins,
participants per event, emails per day, storage (MB), hostnames and open invite
links. They default to no limit, so a single-org instance never hits one. They're
enforced in the database (the email limit in the send-email hook), so every path
respects them. Platform admins and the CLI aren't held to them.

On Instance → Organizations, **Limits...** overrides any of them for one org: a
number, "No limit", or the instance default. Only platform admins can change
these; an org's owners can see their own limits and usage.

**Status...** restricts or suspends an org, with a reason its members see:

- **Restricted:** members can sign in and read, but every write to the org's rows
  is refused by the database, including through functions. A notice explains
  why.
- **Suspended:** the org's hostname shows only a notice, its mail is switched
  off, and the database returns none of its rows to anyone but instance admins,
  through the API as well as the app. Files in public storage buckets are still
  served by address.

Every public page (project galleries, invite links) has a **Report** button.
Reports appear in Instance → Reports; closing one doesn't change the org. A plugin's
tables need the same guard as core's: call `select private.guard_org_status('public.<table>')`
in its migration for any table with an `org_id` or `event_id`.

Instance admins must set up an authenticator app before they can use `/admin`; see
[auth.md](./auth.md#instance-admins-and-a-second-factor).
