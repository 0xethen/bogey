# 0019: An all-in-one compose bundles the Supabase services

**Status:** accepted (2026-10-10). Extends [0017](0017-runtime-instance-config.md) and
[0018](0018-cli-in-the-image.md).

## Context

Running Bogey meant running Supabase first: Supabase Cloud, or Supabase's own self-hosted compose
with an overlay, several `.env` files to keep in step, and a hand-made set of keys. That is a lot to
ask of someone who only wants a hackathon site on one server.

## Decision

- **`deploy/all-in-one/` is one compose file** with Postgres, Auth, REST, Realtime, Storage, the
  gateway, a one-shot `migrate`, `web` and Caddy. Studio and pg-meta are an optional profile bound to
  `localhost`. The Supabase images are pinned to the versions of Supabase's self-hosted compose at
  tag `self-hosted/v0.8.2`; its Postgres setup scripts are used unchanged.
- **Kong is the gateway.** Supabase's default is now Envoy, but its Kong configuration is a short
  declarative file we can cut down to Auth, REST, Realtime and Storage, so the dashboard, pg-meta,
  GraphQL, edge functions and the unauthenticated MCP endpoint have no route at all. Legacy JWT keys
  are used, so there are no `sb_` keys to translate.
- **Caddy is the only published service.** It sends Supabase's four path prefixes to the gateway and
  the rest to Bogey, on the same hostnames, so there is no second domain and no CORS. `web` reaches
  the public address through a network alias on Caddy.
- **`bogey setup --all-in-one` makes every secret** with Node's `crypto` (the JWT secret, the keys
  signed with it, passwords, the hook secret) and writes one private `.env`. Re-running it keeps what
  exists. Auth is configured by the compose file: the sign-up hook, the Send Email hook at
  `http://web:3000`, six-digit codes, authenticator apps, redirect URLs from the hosts given.
- **The database reaches the app internally.** `bogey org init` sets `tenancy.appUrl` to
  `http://web:3000` when `BOGEY_APP_URL` is set and nothing else has been chosen.

## Consequences

- One path from a bare server to a running instance, and it is the one we test.
- We carry a copy of Supabase's database scripts and a cut-down gateway file; a Bogey release says
  when to move to a newer Supabase tag.
- Supabase Cloud and a self-run Supabase stay supported, with their own pages.
- The bundle has not been booted by the author of this change; see the progress notes.
