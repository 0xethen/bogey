# Your own Supabase

Run Supabase's self-hosted stack yourself and point Bogey at it. If you would rather not run Supabase
separately, [all in one](all-in-one.md) bundles the pieces Bogey needs; for a hosted project, see
[Supabase Cloud](supabase-cloud.md). This page is for a stack you already have, or want to keep apart
from Bogey.

Bogey keeps its whole schema in `supabase/schemas/`. `bogey db baseline`
builds those files into a single migration,
`supabase/migrations/20260924000000_baseline.sql`. Every instance applies
that one file. See [ADR 0002](../adr/0002-schema-layout.md).

## What the schema needs

- **Postgres 17** with the `pg_net`, `pg_cron` and `supabase_vault`
  plugins. All three ship with Supabase Cloud and with the official
  self-hosted images.
- **The Before User Created auth hook**, pointing at
  `pg-functions://postgres/private/before_user_created`.
  - **Supabase CLI:** this is already set in `supabase/config.toml` under
    `[auth.hook.before_user_created]`.
  - **Self-hosted (docker compose):** set these on the `auth` service:
    ```env
    GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true
    GOTRUE_HOOK_BEFORE_USER_CREATED_URI=pg-functions://postgres/private/before_user_created
    ```
- **Redirect URLs.** Add every host that serves Bogey. Globs are allowed,
  for example `https://*.bogey.example.com/**`. If a redirect URL doesn't
  match, sign-in links quietly land on the site URL instead.
  - Self-hosted: set `GOTRUE_URI_ALLOW_LIST`.
  - Supabase CLI: `additional_redirect_urls` in `config.toml`.
- **Sign-up must stay enabled at the auth level.** The hook is the real
  gate, and it reads each org's `registration.signup` setting (`open`,
  `invite` or `closed`).
- **SMTP.** Sign-in is passwordless: users get a 6-digit code or a link by
  email. Configure a real SMTP server before inviting anyone, and turn on the
  Send Email hook so emails carry each org's name and wording (see
  [email.md](email.md)).

## Self-hosted Supabase with Docker, step by step

This is tested with the official stack at tag `self-hosted/v0.8.2`, where the
gateway is Envoy on port 8000.

```sh
git clone --depth 1 --branch self-hosted/v0.8.2 https://github.com/supabase/supabase /tmp/supabase
mkdir -p /opt/supabase && cp -rf /tmp/supabase/docker/. /opt/supabase && cd /opt/supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env      # JWT secret, legacy keys, db/dashboard passwords
sh utils/add-new-auth-keys.sh --update-env  # sb_publishable_ / sb_secret_ keys
```

Edit `.env`:

| Variable                                        | Value                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`       | the public address, e.g. `https://db.example.com` and `https://db.example.com/auth/v1` |
| `SITE_URL`                                      | where Bogey is served                                                                  |
| `ADDITIONAL_REDIRECT_URLS`                      | every Bogey host, comma-separated globs, e.g. `https://hacks.example.com/**`           |
| `SMTP_*`                                        | your mail provider                                                                     |
| `ENABLE_PHONE_SIGNUP`, `ENABLE_ANONYMOUS_USERS` | `false`                                                                                |
| `COMPOSE_FILE`                                  | `docker-compose.yml:docker-compose.bogey.yml` (after copying the overlay in, below)    |
| `POOLER_TENANT_ID`                              | a short name for this instance, e.g. `bogey` or your org slug (see below)              |

Keep the upstream compose file untouched. Bogey's own settings are an overlay in this
repo, [`deploy/supabase/docker-compose.bogey.yml`](../../deploy/supabase/docker-compose.bogey.yml).
Copy it next to Supabase's compose file and add three values to Supabase's `.env`:

| Variable                 | Value                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `BOGEY_URL`              | where Bogey is served, reachable from the auth container, e.g. `https://hacks.example.com` |
| `SEND_EMAIL_HOOK_SECRET` | the same `v1,whsec_...` value as in Bogey's `.env` (`bogey setup` makes one)               |
| `BOGEY_HOSTS`            | every host Bogey is served on, comma-separated                                             |

It turns on the sign-up gate, the Send Email hook ([email.md](email.md)), six-digit codes,
and the authenticator-app factor instance admins use ([auth.md](auth.md)). It's what
this guide's `COMPOSE_FILE` setting points at.

Start the stack with `sh run.sh start`, then apply the schema as `postgres`:

```sh
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 \
  < supabase/migrations/20260924000000_baseline.sql
```

### Connecting the CLI to the database

`bogey db`, `plugins migrate`, `backup`, `upgrade`, `repair` and `reset` talk to
Postgres directly. Put the connection string in Bogey's `.env` once instead of
passing `--db-url` every time:

```sh
DATABASE_URL=postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@db.example.com:5432/postgres
```

Port 5432 on the Supabase host is Supavisor (the pooler), not Postgres itself.
Supavisor finds the database from the part of the username after `postgres.`,
which is `POOLER_TENANT_ID`. The upstream `.env.example` sets that to
`your-tenant-id`. That works, but it reads like a placeholder, and `bogey setup`
throws away values that look like placeholders. Give it a real name.
Percent-encode any special characters in the password.

**To change it later**, set `POOLER_TENANT_ID` in Supabase's `.env` and recreate
the pooler:

```sh
cd /opt/supabase && docker compose up -d --force-recreate supavisor
```

On startup the pooler creates a tenant for the new ID if it doesn't have one
(`volumes/pooler/pooler.exs`). The old tenant stays registered, which does no
harm, but connections must use the new username from now on. Update
`DATABASE_URL` in Bogey's `.env`, and anything else that connects through the
pooler. `bogey doctor` warns while `DATABASE_URL` still uses `your-tenant-id`.

Studio's `/mcp` endpoint is blocked by the gateway by default. Leave it
blocked: it gives unauthenticated SQL access.

## Fresh install

```sh
# 1. Point Bogey at the project (repo-root .env)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>   # server, CLI and runner only; never PUBLIC_

# 2. Apply the schema
supabase link --project-ref <ref>     # or, for self-hosted: supabase db push --db-url postgres://...
supabase db push

# 3. Create your org and become its owner
bogey org init --org acme --name "Acme Hacks" --owner you@acme.org --host hacks.acme.org --demo

# 4. Sign in
bogey login you@acme.org
```

`--demo` also creates a demo hackathon and a demo contest. You can delete
them from `/admin` whenever you like, or recreate them with
`bogey seed demo`.

## Wiping a Bogey 2 alpha database

**There's no upgrade path from the unreleased Bogey 2 alpha.** The schema was
redesigned from scratch for the Bogey 2 release, so moving to it means starting
with an empty database. Releases from here on upgrade in place (see
[Upgrading](upgrading.md)).

1. **Back up, even if you plan to throw the data away.**
   ```sh
   pg_dump "$DATABASE_URL" --schema=public --schema=auth --schema=storage -Fc -f bogey2-alpha-backup.dump
   ```
2. **Reset.**
   - **Supabase CLI or local:** `supabase db reset`. This applies
     `migrations/` and then runs `seed.sql`, which is intentionally empty.
   - **Supabase Cloud:** create a new project. This is the cleanest option.
     Alternatively, go to Database → Reset in the dashboard.
   - **Self-hosted:** stop the stack, delete the database volume
     (`volumes/db/data`), start the stack again, and then run
     `supabase db push --db-url ...`.
3. **Old accounts are kept.** The baseline gives every existing `auth.users`
   row a profile. Those accounts belong to no org until you add them, either
   with `bogey org init` or through an invite. To start with no accounts at
   all, delete them in Authentication → Users.
4. **Update the hook URI.** It moved from `bogey/before_user_created` to
   `private/before_user_created`. Change the hook setting as described above,
   then run `bogey doctor`.
5. **Create the first org** as described in _Fresh install_, step 3.

## Changing the schema

See [Contributing](../contributing.md#changing-the-schema).

## HTTPS on a private network (Tailscale)

If the stack lives on a tailnet, `tailscale serve` can provide HTTPS with a
real certificate. Turn on HTTPS certificates in the Tailscale admin console
first (DNS page).

Don't point `tailscale serve` straight at port 8000. Its traffic arrives
from the host, which is exactly the source the gateway trusts for `/mcp`.
Put a small proxy in front that refuses `/mcp` instead:

```yaml
# docker-compose.bogey.yml
bogey-https:
  image: caddy:2.10-alpine
  ports: ["127.0.0.1:8081:8081"]
  volumes: ["./volumes/bogey/Caddyfile:/etc/caddy/Caddyfile:ro"]
```

```caddyfile
:8081 {
	@mcp path /mcp* /api/mcp*
	respond @mcp "Not available here" 403
	reverse_proxy api-gw:8000 {
		header_up X-Forwarded-Proto https
	}
}
```

Then:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8081
```

After that, set `SUPABASE_PUBLIC_URL` and `API_EXTERNAL_URL` to the
`https://<machine>.<tailnet>.ts.net` address, and restart `auth`, `studio`
and `api-gw`. MCP remains reachable only through an SSH tunnel.
