# 0029: The keys that set the instance's trust boundary belong to the operator

**Status:** accepted (2026-10-15). Refines [0003](0003-settings.md), which promised a security floor in
`bogey.config.ts` that was never built, and [0017](0017-runtime-instance-config.md).

## Context

[0015](0015-operator-actions-cli-only.md) keeps host control out of the web app so a stolen
platform-admin session can't become host compromise. Some instance settings had the same reach
and were still edited in the app:

- `network` (`clientIpHeader`, `trustedHops`, `trustedProxies`) decides which forwarded address the
  database believes. Adding `0.0.0.0/0` to `trustedProxies` let anyone claim any address with
  `x-bogey-client-ip`, which turned every event's network limit off.
- `tenancy.appUrl` is where the database's `pg_net` sends a signed request every minute. Setting it
  from a browser made the database call any address, including ones on the host's private network.
- `accounts.requireAdminMfa` could be turned off by the admins it protects.

Instance rows of `settings` were also readable by anonymous visitors, so the trusted proxy list,
`appUrl` and the instance's limits were public. And `bogey db baseline` copied the checkout's
`brand.name` into the shared defaults SQL, so every instance on the published image had the
upstream checkout's name as its SQL default.

Moving these settings into `bogey.config.ts` alone wouldn't help: the database is the authorization
boundary (see [security-model.md](../architecture/security-model.md)), and it can't read the file.

## Decision

- **Operator keys.** A settings namespace can list `operator` keys in the registry. At the instance
  level, a trigger (`settings_operator_keys`) refuses any change to them from `anon` or
  `authenticated`, so only the service role (the server and the CLI) and `postgres` can change them.
  `bogey db baseline` generates `private.operator_keys()` from the registry next to the defaults, so
  SQL and TypeScript share one list. They are `tenancy.appUrl`, `accounts.requireAdminMfa` and all of
  `network`.
- **The file declares them.** `bogey.config.ts` gains `appUrl`, `network` (with `trustProxy`, which
  replaces `BOGEY_TRUST_PROXY`) and `security.requireAdminMfa`, validated with the same Zod schemas
  as the settings they become. On its first request after it starts, the server writes the keys the
  file declares to the database with the service role. `bogey config apply` does the same without a
  restart, and `bogey config check` and `bogey doctor --remote` report any difference. A key the file
  leaves out keeps the database's value, so upgrading doesn't reset an instance that set these in
  the app before.
- **The app shows them read-only**, labeled "Set in bogey.config.ts". `bogey mfa off` stays as a way
  back in for locked-out admins and warns when the file would put the requirement back.
- **Instance rows of `network`, `tenancy`, `limits` and plugins' limits are readable by platform
  admins only.** Other instance namespaces stay public, because plugins such as the captcha read
  their instance settings on the sign-in page.
- **Security headers come from the file** (`security.headers`): `frame-ancestors` (default `'self'`),
  `X-Content-Type-Options`, `Referrer-Policy`, opt-in HSTS, and an optional full
  `Content-Security-Policy`. A default policy beyond framing would break plugins that load their own
  scripts, so it's off.
- **The registry reads no instance file.** The `branding.name` default is gone; the server falls back
  to `brand.name` from `bogey.config.ts` at runtime.

`vite.config.ts` was considered as the place for this config and rejected: the published image runs
the built server with plain Node, and [0017](0017-runtime-instance-config.md) moved instance config
out of the build so one image serves every instance.

Left in the app on purpose: `tenancy.defaultOrg` (an ordinary admin choice, set by `bogey org init`),
`limits` (per-org overrides are already admin actions, so locking only the ceiling would protect
nothing), and `signin.providers` (a provider works only if GoTrue was configured for it).

## Consequences

- A stolen admin session can no longer spoof client addresses, redirect the database's outgoing
  calls, or remove the admin second factor.
- Operators who set these in the app keep their values; to change them later, they use the file or
  the CLI.
- The web server needs `SUPABASE_SERVICE_ROLE_KEY` to apply the file. It already needs that key for
  `@bogey/db/admin`.
- `@bogey/config` is still mostly the settings registry, messages and other shared definitions.
  Splitting those into their own package is a rename for clarity and is left for later.
