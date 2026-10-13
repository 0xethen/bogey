# 0003: One settings table with instance → org → event precedence, secrets in Vault

**Status:** accepted, 2026-09

## Context

Configuration lived in many places:

- tracked files (`packages/config`)
- the environment
- `config.toml`
- typed columns on `orgs` and `events`
- unused JSONB (`orgs.settings`, `events.config`)
- `extension_settings`, including an instance-wide row that exposed the
  Discord webhook secret to every member
- cookies
- hard-coded constants

Organizers couldn't tell where a value came from, and hosted orgs can't edit
files.

## Decision

- **One `settings` table** holds `(scope, org_id?, event_id?, namespace,
  value)`. The namespaces are registered in `@bogey/config` with a Zod
  schema, a scope, and whether each key is lockable or secret. Plugins
  register theirs through their manifest.
- **Precedence.** When `readSettings(event)` resolves a value, event beats
  org, and org beats instance, except for a key that a higher scope lists in
  `locked_keys`.
- **Validation.** Writes go through `save_settings()`. That RPC checks
  permissions for the scope, and the server validates the value against the
  Zod schema before calling it. A column is used instead of a setting only
  when RLS or a trigger needs the value: team sizes, timezone, visibility.
- **Secrets** are stored in Supabase Vault and referenced from `secrets`.
  Organizers can write them but never read them back.
- **What stays in files:** `.env` (connection strings and keys) and
  `bogey.config.ts`, which holds the plugin allowlist and the security floor
  (for example `dangerouslyUseHttp`). Those are the things a hosted org must
  not be able to change.
- **One settings area.** `/admin/settings` has Instance, Organization and
  Event tabs. Each field shows whether its value is inherited or overridden,
  and whether it is locked.
- **Generated reference.** `bogey config docs` writes
  `docs/reference/settings.md` from the registry.

## Consequences

- A few settings that are read on every request (branding, UI constants)
  are cached per org by the server for a short time. Saving a setting
  invalidates that cache.
- Self-hosters who liked configuring in files can seed settings with
  `bogey settings import settings.json`.
