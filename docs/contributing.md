# Contributing

## The workspace

A pnpm workspace run with [Vite+](https://viteplus.dev) (`vp`). Packages import
each other as `@bogey/<name>`.

| Path               | What it is                                                                     |
| ------------------ | ------------------------------------------------------------------------------ |
| `apps/web`         | The app: TanStack Start and Router, file-based routes in `src/routes`          |
| `packages/config`  | Defines configuration: `defineConfig`, the settings registry, the theme list   |
| `packages/db`      | Supabase clients, typed queries in `src/queries/`, generated types             |
| `packages/ui`      | Shared components (shadcn-based) and the form kit                              |
| `packages/plugins` | The plugin API; `bundled/<key>/` ships with Bogey, `installed/<key>/` is yours |
| `packages/utils`   | Framework-free helpers                                                         |
| `tools/cli`        | The `bogey` CLI                                                                |
| `tools/runner`     | The challenges runner (judges contest solutions in Docker)                     |
| `supabase/schemas` | The schema; RLS is the real authorization boundary                             |
| `bogey.config.ts`  | This instance's name, theme and disabled plugins                               |

  <!-- bogey CLI (commenting without ticks for search purposes) ^^ -->

[CONTEXT.md](../CONTEXT.md) is the glossary (window, entrant, registration...).

## What to install

Everything in [Getting started](getting-started.md#you-need), and the
**Supabase CLI**, which every maintainer needs. Use the version CI pins
(`.github/workflows/ci.yml`, currently 2.120.0), since the generated types differ
slightly between versions:

```sh
brew install supabase/tap/supabase    # or see supabase.com/docs/guides/local-development/cli
```

It's what `bogey types` runs, what `bogey db migration` diffs with, and what runs
the pgTAP suites (`supabase test db`). `supabase start` and `supabase test db` also
need Docker; generating types from a database you can reach doesn't.

## Generating types

`packages/db/src/types/database.gen.ts` describes `supabase/schemas`, not any
deployment. It's committed, the app builds against the committed file, and nothing
in production generates it: Vercel (or any host) and Supabase Cloud never run
`bogey types`. CI regenerates it from a fresh `supabase start` and fails if the
committed file differs, so it can't drift from the schema.

After changing `supabase/schemas`, apply the change to a database that has your
schema, then generate from that database. Any database works, as long as it's
current: `bogey types` refuses to call it done when the database differs from
`supabase/schemas` (run `bogey db repair` first). It keeps only what the schema
files create, so plugin tables in that database stay out. Never edit the file by
hand. Pick whichever database you can reach:

- **The database in your `.env`** (a development Supabase, even a self-hosted one on
  another machine reached over a tailnet): with `DATABASE_URL` set, that's all it takes,
  from your own machine:

  ```sh
  bogey db repair --yes
  bogey types        # uses DATABASE_URL; retries without TLS when the server has none
  ```

  You don't need Docker or a shell on the database's server. (`bogey` is the alias from
  [Getting started](getting-started.md#a-bogey-command); `vpr bogey` works the same.) If its Postgres port isn't
  exposed, tunnel it first (`ssh -L 54329:localhost:5432 you@server`) and use
  `postgresql://...@localhost:54329/postgres`, or use `--mcp` with Studio's MCP
  endpoint through the same tunnel.

- **A Supabase Cloud project** (a staging project with your branch's schema): either
  its session pooler URL from Project Settings → Database (`--db-url`, TLS on), or
  `vpr bogey types --project-id <ref>` with `SUPABASE_ACCESS_TOKEN` set (Account →
  Access Tokens), which reads the schema through the Management API without a
  database password. Don't generate from production unless it already has your
  change; the drift check will say so.
- **Docker on your machine:** `supabase start`, then `bogey types --local` (also what
  plain `bogey types` does when `.env` has no `DATABASE_URL`). This is what CI does.

`packages/db/src/types/schema.gen.ts` needs no database: `bogey types --schema` reads
`supabase/schemas` for what `supabase gen types` leaves as plain strings, so the TypeScript
lists can't drift from it. It holds `CORE_PERMISSIONS` (every permission the schema checks or
grants), `CORE_AUDIT_ACTIONS` (every action it writes to the audit log; `'<prefix>.' || x.<column>::text`
stands for each value of the `<prefix>_<column>` enum) and `COLUMN_VALUES` (what each
`check (column in (...))` allows). Every `bogey types` writes it, `bogey watch --schema`
keeps it current while you edit the schema, and a test fails when the committed file is stale.
A new audit action fails type checking in `packages/db/src/audit.ts` until it has a label.

## Everyday commands

## Everyday commands

```sh
vp install        # after pulling
vpr dev           # app on :3000, plus `bogey watch`
vp check --fix    # format, lint, type-check
vpr ready         # check, every package's tests and builds: run before committing
```

A commit hook runs `vp check --fix` on staged files.

In development, TanStack Devtools (bottom right) has a **Bogey** tab: the
session and event access, installed plugins, loaded settings, realtime
channels, what the save bar holds, registered shortcuts and the screen's
queries.

## Conventions

- **Type-safe throughout.** No `any` and no casts to paper over types; use the
  types the libraries export.
- **Comments are short and plain.** A few words saying what or why, like
  `// loops through KV`. Rationale that needs a paragraph goes in the docs.
- **UI primitives live in `@bogey/ui`.** Apps compose them. Reuse a pattern
  before inventing one.
- **Forms use the form kit** (`@bogey/ui/lib/form`): Zod schemas for what the
  browser can check, server results for the rest. Submit buttons are never
  disabled for field errors, only while pending. Required fields show `*`.
- **Destructive actions sit behind a confirmation** (`<Button confirm={{ ... }}>`).
- **Buttons explain themselves with `tooltip`** (`<Button tooltip="...">`), which also shows while the button is
  disabled, for saying why. Don't wrap a `Button` in `Tooltip` by hand.
- **Lists of records are `DataTable`s**, with search, filters and pages as needed; see
  [Tables](architecture/tables.md).
- **Settings go through the registry.** Declare the key, its default and its
  field hint in `packages/config/src/settings.ts`; never write a fallback for a
  setting in SQL or TypeScript.

## Adding to ⌘K

The menu lists pages and actions. A search starting with `/` shows only
actions, `#` only pages.

- **A page:** give its route `staticData.command` (`label`, `keywords`,
  `group`, `when`). Routes with a title show up by default; `command: false`
  keeps one out.
- **An action:** something to do rather than somewhere to go. App-wide ones
  are listed in `CmdK.tsx`; a component that offers one while it's on
  screen calls `registerAction({ id, label, group, run })` from
  `apps/web/src/lib/actions.ts` in an effect and returns its cleanup. Labels
  of actions that open something end with "...".

## Changing the schema

1. Edit the right file in `supabase/schemas/`.
2. Every new table gets RLS and its policies in the same change.
3. Before the first release, `bogey db baseline` rebuilds the one baseline
   migration (and the SQL setting defaults) in place. After `bogey db freeze`
   has marked a release, add a migration instead: `bogey db migration <name>`
   (see [Upgrading](self-hosting/upgrading.md#migrations)).
4. Add or extend a pgTAP test in `supabase/tests/database/` and run
   `supabase test db`.
5. `bogey types` regenerates `packages/db/src/types/database.gen.ts` (see
   [Generating types](#generating-types)); commit it with the schema change.
6. A new `SECURITY DEFINER` function in `public` must be added, with a reason,
   to `packages/db/tests/rpc-surface.test.ts`.

CI checks the baseline is current, runs every pgTAP suite against a fresh
`supabase start`, and builds the Docker image.

## Generated files

Don't edit these by hand; `bogey watch` (run by `pnpm dev`) keeps them current.

| File                                                                     | From                             | Command             |
| ------------------------------------------------------------------------ | -------------------------------- | ------------------- |
| `supabase/migrations/..._baseline.sql`                                   | `supabase/schemas/`              | `bogey db baseline` |
| `supabase/schemas/04_settings.defaults.gen.sql`                          | the settings registry            | `bogey db baseline` |
| `packages/config/src/themes.gen.ts`, `packages/ui/src/styles/themes.css` | `packages/ui/src/styles/themes/` | `bogey themes`      |
| `docs/reference/settings.md`, `docs/reference/cli.md`                    | the registry and CLI             | `bogey docs`        |
| `packages/db/src/types/database.gen.ts`                                  | the database                     | `bogey types`       |
| `packages/db/src/types/schema.gen.ts`                                    | `supabase/schemas/`              | `bogey types`       |
| `apps/web/src/routeTree.gen.ts`                                          | `apps/web/src/routes/`           | the router plugin   |

## Docs

`docs/` is the source of truth; the GitHub wiki is generated from it on every
push to `main` (`bogey docs wiki`). Link between docs with relative `.md`
paths, and they'll work both on GitHub and in the wiki.

## Cutting a release

Write `CHANGELOG.md`'s Unreleased entries as you go, with upgrade notes. Then, on an
up-to-date `main`:

```sh
vpr bogey release                  # asks: patch, minor, major, a prerelease or another version
vpr bogey release minor --pre beta # 2.2.0 → 2.3.0-beta.0
vpr bogey release beta             # in a prerelease: the next beta, or alpha → beta.0
vpr bogey release minor            # 2.3.0-rc.1 → 2.3.0
vpr bogey release 2.3.0-rc.0       # or name it
vpr bogey release minor --dry-run
```

Prereleases go alpha (still changing), beta (feature-complete, being tested), rc (ships as
is unless something breaks). Each gets its own changelog section, GitHub prerelease and
image tag, but not `latest`, the `<major>.<minor>` tag or the bogey-instance default, and
`bogey upgrade` moves to it only with `--pre` (or `--to v<version>`). The
stable release takes its prereleases' sections into its own, so its notes cover everything
since the last stable release; it needs no new Unreleased entries.

It checks the tree, runs `vp check`, the tests and the generated-file checks, sets
`package.json`'s version, turns Unreleased into `## <version> (<date>)`, freezes the
baseline on the first non-prerelease (so 2.0.0, after its release candidates), commits
`Release v<version>`, tags it, and asks before pushing `main` and the tag (`--push` doesn't
ask). Not pushed, it prints how to push or undo.

The pushed tag starts the release workflow, which first runs `bogey release check <tag>`
(package.json and the changelog match the tag; the pre-push hook in `.vite-hooks` runs it
too), then builds and pushes `ghcr.io/0xethen/bogey`, packs the source, attests both, and
publishes the release from a draft. The repository has _immutable releases_ on
(`gh api repos/0xethen/bogey/immutable-releases` should say `"enabled": true`), so the tag
and files lock when it's published and GitHub signs a release attestation. Check with
`gh release verify v<version>`.

After a stable release (not a prerelease), the workflow commits to
[bogey-instance](https://github.com/0xethen/bogey-instance) so new instances build that
release by default (`BOGEY_VERSION` in its `Dockerfile`, `compose.yml` and README). That needs
the `INSTANCE_TEMPLATE_TOKEN` secret: a fine-grained token with _Contents: read and write_ on
bogey-instance. Without it the job warns and skips. Template changes beyond the version, like a
new `bogey.config.ts` key, are still made by hand.

Nothing can be amended afterwards: a mistake is a new patch release.

### Security releases

Reports arrive as private advisories ([SECURITY.md](../SECURITY.md)). To ship a fix:

1. In the advisory's draft, fill in **Affected products**: ecosystem _Other_, package `bogey`,
   affected versions as a range (`>= 2.0.0, < 2.0.2`) and the patched version (`2.0.2`). Instances
   read these fields: the affected range is how a running Bogey knows it's vulnerable, so write it
   with `>=`, `>`, `<=`, `<` and `=`, separating the bounds with commas. Request a CVE there if you want one.
2. Fix it in the advisory's temporary private fork and merge that, so the fix isn't public before the release.
3. Under Unreleased in `CHANGELOG.md`, add a `### Security` section: one bullet per advisory with
   what an operator should know, the affected versions and the advisory's link, for example
   `- Org admins could read another organization's registrations. Affects 2.0.0 to 2.0.1. ([GHSA-xxxx-xxxx-xxxx](https://github.com/0xethen/bogey/security/advisories/GHSA-xxxx-xxxx-xxxx))`.
   The link works once the advisory is published. Release notes come from this section, and the
   release workflow adds "(security fix)" to the release's title when it has one.
4. Cut the patch release (`vpr bogey release patch --push`).
5. When the release is published, publish the advisory. From then on, every instance running an
   affected version shows it to its admins, `bogey doctor` fails, and the console shows it.

An advisory reaches instances only once it's published, and is read from the `upstream`
repository in their `bogey.config.ts`. An advisory can list more than one affected range (one
**Affected products** entry each); a version in any of them counts as affected. A range Bogey
can't read (`~2.0`, prose) is skipped rather than guessed at, so stick to the forms in step 1.
