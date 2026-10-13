# 0009: Bogey ships no plugins; each plugin carries its own SQL

**Status:** accepted, 2026-09. Supersedes [0008](0008-plugin-data.md). Partly superseded by
[0026](0026-bundled-plugins-and-team-board.md): plugins in `packages/plugins/bundled/` ship with Bogey.

## Context

Plugins are published separately from Bogey. The public repo must ship with
no plugins. Under ADR 0008, plugin tables were part of the core baseline, and
a file allowlist named plugins that a fresh clone doesn't have.

## Decision

- **Where plugins live.** A plugin is a folder,
  `packages/plugins/installed/<key>/`, containing `manifest.ts`,
  `runtime.tsx`, and optionally `migrations/`, `seed.sql` and
  `tests/*.test.sql`. Everything in `installed/` except its README is
  gitignored.
- **Installed means present.** Putting a plugin's code on disk is the
  operator's act of trust. `disabledPlugins` in
  `packages/config/src/plugins.ts` switches an installed plugin off for the
  whole instance.
- **Enablement.** Orgs and events turn plugins on through settings
  (`plugins.enabled` / `plugins.available`). RLS checks it with
  `private.plugin_enabled`, as before.
- **Plugin SQL.** Core never references a plugin. The baseline is core only.
  `bogey plugins migrate` applies the enabled plugins' migrations, and `bogey plugins sql` prints them and
  `seed.sql`; apply them after the baseline. Plugins add roles by
  inserting into `roles` (key `<plugin>.<role>`, label, `source`), and
  permissions by inserting into `role_permissions`. Core exposes generic permissions, such
  as `clarifications.answer`, for plugin roles to grant.
- **Source is required.** Every manifest declares `source.repository`. There
  is no `bundled` flag.
- **Demo data.** Plugins provide it as `public.<key>_seed_demo(p_org uuid)`,
  which `bogey seed demo` calls.

## Consequences

- A fresh clone runs with no plugins. The core suite of pgTAP tests passes
  with no plugins installed. Plugin tests run from each plugin's folder,
  after its schema has been applied.
- Plugin imports resolve through `@bogey/plugins/*`, the package importing
  itself, so a plugin needs no build setup of its own.
