---
name: bogey-cli-config
description: Bogey (hackathon platform) tools/cli and packages/config conventions — CLI UX/testability decisions, config.toml vs docker-compose auth gotchas, plugin allowlist rules, and the settings tiers. Use when editing tools/cli/src or packages/config/src.
---

# Bogey CLI & config conventions

## CLI (`tools/cli/src`)

- Credential lookup returns a union type rather than throwing — every caller
  already returns `{exitCode, output}`, and a plain error sentence beats a
  stack trace for a missing `.env` key.
- Account-existence checks return `null` (not `false`) when the instance is
  unreachable/unrecognized, so callers don't mistake an outage for permission
  to create an account.
- `bogey login <email>` refuses unknown addresses unless `--create` is passed:
  GoTrue's `admin/generate_link` silently provisions a user for an unknown
  address, so without the guard a typo creates a real account. Needs the
  service-role key, hence CLI-only.
- Seed fixture metadata is a lookup table, not per-fixture branches — fixtures
  differ only by which RPC to call and what to print. Seed logic itself lives
  in DB functions (`private.seed_demo_*`, plugins' `public.<key>_seed_demo`),
  not TypeScript, so a schema change that breaks a seed is caught in review.
- Plugin listing/metadata reads the directory and scans text rather than
  importing modules — the CLI runs in plain Node (no `import.meta.glob`) and,
  more importantly, listing must not execute untrusted plugin code. Manifest
  fields read this way are all optional, so a scan miss degrades display
  rather than failing the command.
- Scaffolded plugin manifests auto-fill the `author` field from git identity —
  a "TODO" placeholder would validate but tell organizers nothing.
- Plugin update-check CLI command reuses the same `checkPluginUpdates` the
  organizer UI uses, to avoid two disagreeing answers to "are we up to date."
- `db studio`'s browser-launch is injected as an `opener` param (test seam,
  mirrors `runDb`'s pattern) — testing via the real binary would assert
  machine-environment facts ("no local Supabase listening") rather than the
  function's actual behavior.
- Plugin manifests carry `api` (the plugin API version); the CLI reads it by
  text scan too and marks plugins this Bogey won't load.
- `bogey plugins link <folder>` points `packages/plugins/installed` at a plugin
  checkout and writes it a `node_modules` of links and a `tsconfig.json` (ambient
  globals like `Tuple`), so an editor opened there type-checks
  plugins the way Bogey's build does. It leaves a tsconfig it didn't write alone.
- A plugin's SQL is `migrations/<n>_<name>.sql`; an older lone `schema.sql` counts as
  migration 0, so moving it to `migrations/0_schema.sql` keeps it applied.
- Anything that runs a program (psql, git, vp, supabase) takes an injected
  `Runner` (`lib/migrations.ts`), so tests fake it instead of spawning.
- Schema changes after the first release are append-only migrations:
  `bogey db freeze` writes `supabase/RELEASED`, then `bogey db baseline`
  refuses and `bogey db migration` adds files. `bogey db migrate` records each
  in `supabase_migrations.schema_migrations`, the Supabase CLI's own table.
  `bogey upgrade` chains backup, merge, install, migrate, regenerate, doctor.
- Recorded versions aren't proof the schema is there: before the first release the baseline is
  rebuilt under the same version. So `db status`, `db migrate` (when nothing is pending) and
  `doctor` also run `schemaDrift` (`lib/repair.ts`, the same catalog diff `repair` plans from)
  and point at `bogey db repair`. Plugin migrations record a sha256 of the file; one edited after
  it was applied is flagged (a warning in `plugins migrate`, an issue in `doctor`).
- Every `fetch` takes `AbortSignal.timeout` (`REQUEST_TIMEOUT_MS`/`DOWNLOAD_TIMEOUT_MS` in
  `lib/credentials.ts`) and `spawnRunner` sets `PGCONNECT_TIMEOUT`, so an unreachable host is an
  error rather than a hang. "No migrations yet" is only psql's missing-`supabase_migrations`
  error; any other "does not exist" (role, database) is a wrong URL.
- Schema-changing transactions (`repair`, `db migrate`, `plugins migrate`) set `LOCK_TIMEOUT` and
  go through `retryingLockConflicts`: they lock table after table while every-minute pg_cron jobs
  (e.g. `remind_sessions`: session_slots then events) read in their own order, so an occasional
  deadlock is expected and a rolled-back transaction is safe to rerun.
- `bogey db repair` diffs `supabase/schemas` against the live catalog (tables, columns,
  enum labels) and re-runs everything else rewritten to be rerunnable (`create or
  replace`, `if not exists`, drop+create policies, `on conflict do nothing`). Constraints
  are compared by building each core table in a rolled-back scratch schema and diffing
  `pg_get_constraintdef` by name: stale ones drop before the seed rows, new ones add after
  (check/FK as `not valid`, then validated with a warning on failure). It never drops a
  table, column or row. Schema-file `do` blocks must stay rerunnable for it to work.
- `bogey release` is the only way versions move: it bumps root `package.json` (what the
  app's update banner compares), stamps CHANGELOG, freezes on the first non-prerelease,
  commits, tags, pushes. `bogey release check <tag>` reads the tag's files with `git show`
  and gates both `.vite-hooks/pre-push` and release.yml's `verify` job.
- `config.toml` port is read via regex text-scan of one `[section]`, not a
  TOML parser — matches `tools/cli/src/lib/checks.ts`; the file
  is small/stable enough that a parser dependency costs more than the regex.
- `vpr bogey` is a root `vite.config.ts` task with `cache: false`, not a package.json
  script: the root sets `run.cache: true`, which cached scripts and replayed old output
  (a stale sign-in code) without giving the CLI a terminal. Uncached, it gets a real TTY.
- Questions go through a `Prompter` (`lib/prompt.ts`: text, select, confirm), handed to
  commands by `run(argv, cwd, prompter)`. bin.ts passes `terminalPrompter()` (null without
  a terminal); tests pass null or `tests/support/prompter.ts`'s `scripted`. A command with
  missing flags asks for them when it has a prompter and prints its usage when it doesn't,
  so `bogey org init` and `bogey org init --org ...` are the same command. Esc/Ctrl+C
  throw `Cancelled`.
- Commands return plain text that says `bogey <command>`; `lib/present.ts` rewrites that to
  what the person typed (`invocation()`: `vpr bogey`, `bogey`, or the node path) and adds
  color (`lib/style.ts`, honoring NO_COLOR/FORCE_COLOR) on the way to the screen only, so
  tests and the generated `docs/reference/cli.md` never see either. Error prefixes like
  `bogey plugins: ...` name the program and aren't rewritten.
- A wrong command never prints the whole usage. `lib/suggest.ts` names what it's close to: a
  subcommand typed alone (`bogey migrate` → `bogey db migrate`, keeping its arguments), then
  typos of commands and subcommands (`Command.subcommands`, which a new subcommand must join).
  With nothing close, `lib/release-status.ts` compares root `package.json` against the newest
  `v*` tag (`upstream` remote, then `upstream` in bogey.config.ts, then local tags) and says an
  upgrade may have it, offering to run `bogey upgrade` when there's a prompter. Subcommand
  dispatchers (db, org, plugins) answer with `unknownSubcommand(...)`.
- `bogey` alone at a terminal is the menu (`menu.ts`), a picker over the same commands
  showing the command each choice runs.

## Config

- Three tiers: secrets in the root `.env`; instance identity in
  `bogey.config.ts` (`defineConfig`: brand, theme, `plugins.disabled`,
  `security.verboseErrors`); runtime settings in the `settings` table.
- `packages/config` only *defines*: `define.ts`, the settings registry
  (`settings.ts`, schemas + `defaults`), generated `themes.gen.ts`. It must
  stay load-free (shared by CLI, server, browser).
- Settings resolve defaults → instance → org → event. Defaults live only in
  the registry; `bogey db baseline` generates
  `supabase/schemas/04_settings.defaults.gen.sql` from them. Never write a
  `coalesce(..., <default>)` in SQL or `?? <default>` in TS for a setting.
- Read settings with `settingsQueryOptions` (resolved, typed) or
  `ownSettingsQueryOptions` (one scope's stored partial, for editors). Write
  with `updateSettings`/`useSettingsMutation`: it merges, and `null` removes a
  key so it inherits again.
- `bogey plugins enable/disable` edit `plugins.disabled` in `bogey.config.ts`
  by regex, keeping comments. Nothing in the database can install a plugin.
- `enable_signup` in `config.toml` must stay `true` for the
  `before_user_created` hook to fire; setting it `false` disables the
  `registration.signup` gate entirely.
- `config.toml` is only read by the Supabase CLI; self-hosted docker-compose
  configures GoTrue from env vars, so `checkAuthHookWiring` passing says
  nothing about a docker-compose deployment (`checkSelfHostedHookWiring` does).
