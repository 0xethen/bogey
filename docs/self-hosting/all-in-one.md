# All in one

The quickest way to run Bogey yourself: one compose file with Bogey, the Supabase services it needs
and Caddy for HTTPS. You need a server with Docker, a domain name pointing at it (ports 80 and 443
open) and an SMTP server for sign-in mail.

It's the path for one machine and up to a few organizations. For a managed database, or when you
already run Supabase, use [Supabase Cloud](supabase-cloud.md) or [your own Supabase](supabase.md) with
the [plain deployment](deploy.md) instead.

## What runs

| Service          | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `db`             | Postgres 17 with `pg_cron`, `pg_net` and Vault, the data volume             |
| `auth`           | Supabase Auth (GoTrue): sign-in codes, links, providers, authenticator apps |
| `rest`           | PostgREST: the API the app and browsers talk to                             |
| `realtime`       | live updates (the bell, chat)                                               |
| `storage`        | uploaded files, on a volume                                                 |
| `kong`           | Supabase's gateway: checks the key, sets the role                           |
| `migrate`        | runs once per start: `bogey db migrate && bogey plugins migrate`            |
| `web`            | Bogey, with the `bogey` CLI inside                                          |
| `caddy`          | the only thing published; certificates and routing                          |
| `studio`, `meta` | Supabase Studio, only with `--profile studio`, on `localhost` only          |

<!-- bogey CLI (commenting without ticks for search purposes) ^^ -->

Left out because Bogey doesn't use them: edge functions, analytics, the connection pooler, image
transformation and GraphQL. The Supabase images are pinned to what Supabase's self-hosted compose uses
at tag `self-hosted/v0.8.2`, which is what this was written against.

## Set up

1. **Get the files.** From a release (`bogey-all-in-one-<version>.tar.gz`, which unpacks to a folder),
   or from a checkout's `deploy/all-in-one/`.

   ```sh
   curl -fsSL https://github.com/0xethen/bogey/releases/latest/download/bogey-all-in-one-<version>.tar.gz | tar xz
   cd bogey-all-in-one
   ```

2. **Make the secrets and `.env`.** With the CLI from a checkout (`vpr bogey setup --all-in-one ...`),
   or from the image, with nothing installed:

   ```sh
   docker run --rm -v "$PWD:/out" ghcr.io/0xethen/bogey \
     bogey setup --all-in-one --host bogey.example.org --out /out \
     --smtp-host smtp.mail.org --smtp-user me --smtp-pass '...' --smtp-from hacks@mail.org
   ```

   `--host` takes several, comma-separated; the first is the main one. It writes `.env` (readable
   only by you) with a database password, a JWT secret, the anon and service keys signed with it, the
   Realtime and Studio keys and the Send Email hook secret. Run it again to change hosts or mail:
   secrets that exist are kept. Don't change `POSTGRES_PASSWORD` or `JWT_SECRET` by hand once a
   database exists.

3. **Edit `bogey.config.ts`** (your name, theme, disabled plugins). It's mounted into `web` and read
   when the server starts.

4. **Start it.**

   ```sh
   docker compose up -d
   docker compose logs -f migrate web    # the schema applies, then the app starts
   ```

5. **Create your organization.**

   ```sh
   docker compose exec web bogey org init --org acme --name "Acme Hacks" \
     --owner you@acme.org --host bogey.example.org
   docker compose exec web bogey login you@acme.org     # a sign-in code, without email
   ```

   `org init` also sets the instance's app address to `http://web:3000` (unless `bogey.config.ts`
   sets `appUrl`), so the database can reach the app to send queued email. The owner becomes an instance admin; set up an
   authenticator app when asked (see [Sign-in and auth](auth.md)).

6. **Check it.** `docker compose exec web bogey doctor`.

## A trial on your own machine

Without a domain, `--http` serves plain HTTP: `bogey setup --all-in-one --host bogey.localhost --http`.
Browsers send `*.localhost` to your machine; other containers reach it through Caddy's network alias.
Sign-in links need the same address in your browser, so open `http://bogey.localhost`. Don't put
real people's data on it.

## What faces the internet

Only Caddy, on 80 and 443. It sends `/auth/v1`, `/rest/v1`, `/realtime/v1` and `/storage/v1` to the
gateway, which checks the key, and everything else to Bogey. Studio, pg-meta and Postgres have no
public route, and the gateway has none for them, so Studio's `/mcp` endpoint (unauthenticated SQL)
cannot be reached. Studio, when you ask for it, is on `127.0.0.1:54323`; reach it over an SSH tunnel.

Supabase's API lives on the same address as Bogey, so `SUPABASE_URL` is your main host. `web` and the
gateway reach that address through Caddy's network alias, so nothing goes out to the internet and back.

## Many organizations

Set `CADDYFILE=Caddyfile.hosted` in `.env` and `docker compose up -d`. Each host in `org_domains`
gets a certificate on its first visit; see [Deploying](deploy.md#many-organizations). Sign-in links
only work on hosts listed in `ADDITIONAL_REDIRECT_URLS`; for subdomains use a glob such as
`https://*.bogey.example.app/**`.

## Sign-in providers

Google, GitHub, Microsoft, GitLab, Discord, Keycloak and SAML are variables in `.env`; see
[Sign-in and auth](auth.md).

## Backups and upgrades

```sh
docker compose exec web bogey backup --out /tmp/backup && docker compose cp web:/tmp/backup ./backup
```

That is the database (`pg_dump`) and every stored file. The volumes are `db-data`, `storage-data`
and Caddy's `caddy_data` (certificates).

To upgrade, set `BOGEY_IMAGE` in `.env` to the new tag, read its CHANGELOG, then
`docker compose pull && docker compose up -d`. `migrate` applies the new schema before `web` starts.
Supabase's images are pinned in `compose.yml`; a Bogey release says when to move them.

## If something doesn't start

- `docker compose ps` shows what is unhealthy; `docker compose logs <service>`.
- `migrate` fails: read its log. It waits for `auth` and `storage` to be healthy, because the schema
  refers to their tables.
- Pages fail with `ENOTFOUND` or a certificate error from `web`: `BOGEY_HOST` must be the exact host
  in `SUPABASE_URL` and Caddy must have a certificate for it (a real domain, DNS pointing here).
- Sign-in email never arrives: SMTP settings, then [Email](email.md).
