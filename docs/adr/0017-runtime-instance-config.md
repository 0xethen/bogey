# 0017: Instance config is read when the server starts

**Status:** accepted (2026-10-10). Refines [0003](0003-settings.md), which put instance identity in a
tracked file, and [0011](0011-releases-and-upgrades.md), which had instances follow Bogey by forking.

## Context

`bogey.config.ts` was imported by the app, so its values were compiled into the bundle. Changing a
name, hiding "Report an issue" or disabling a plugin meant a rebuild, and a rebuild meant a checkout
of Bogey's source. Most instances never change Bogey's code; they want their name, theme and plugins,
and to take new releases by pulling an image.

## Decision

- **The server reads the file once, at start.** `@bogey/config` loads `bogey.config.ts` (or `.mjs`,
  `.js`, `.json`) from the working directory upward, or the path in `BOGEY_CONFIG`. Node strips the
  types as it loads, so there is no build step. A file that is unreadable or invalid stops the
  server and names the key; `bogey doctor` runs the same check.
- **Keys read at start:** `brand`, `repository`, `upstream`, `updates`, `security`,
  `plugins.disabled`. Editing them needs a restart.
- **Keys that stay build-time:** which themes exist, which plugins are installed, and the logo files
  under `apps/web/public`. A plugin is code, a theme is CSS, and neither can arrive after the bundle.
- **The browser is handed only what it needs**, the way it is handed the Supabase URL: the brand, the
  repository, the disabled plugin list and whether errors are verbose, in an inline script before the
  app loads. `@bogey/config` has a `browser` entry that reads it; `updates` and `upstream` never leave
  the server.
- **The image carries a default copy and a stand-in `@bogey/config/define`.** Deployments mount their
  own file over `/app/bogey.config.ts` read-only. The primary install path becomes an instance
  repository plus the published image; forking is for changing Bogey's code.

## Consequences

- Changing the name or a disabled plugin is an edit and a restart. The image stays the same across
  instances.
- A config that imports anything but `defineConfig` or types will not load in the image. Keep it to
  data.
- Values that look like config but need code (a theme, a plugin) still need a rebuild, and the docs and
  Plugins page say so.
