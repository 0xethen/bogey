Keep everything type-safe, always. No `any`, no arbitrary type-defining. Use imported types from the packages you use whenever possible. `Tuple<T>` (`ReadonlyArray<T>`) is an ambient global (for reasons that you probably shouldn't question).

After changing `supabase/schemas`, run `vpr bogey db repair --yes` to apply it to the dev database (`DATABASE_URL` in `.env`) unless told not to, then regenerate `packages/db/src/types/database.gen.ts` with `vpr bogey types` (it reads `DATABASE_URL`); never hand-edit it. CI fails when the committed types differ from what `supabase/schemas` makes. See `docs/contributing.md#generating-types`. The rest of the schema workflow is in the `bogey-data-layer` skill.

## What Bogey is

An extensible, self-hostable, and performant hackathon/competition platform—one deployable app with a backend to cover it. `apps/web` serves participant, judge, and organizer surfaces together. Organizers manage an event at `/events/<slug>/manage` inside it, gated by a permission (`event.manage`). `/org` is for org admins and `/admin` for instance admins. Instances are forks of this repo: config that would be "instance settings" elsewhere lives in tracked files here.

## Workspace layout

pnpm workspace, packages import via `@bogey/<name>`:

- `apps/web` — the app. TanStack Start/Router, file-based routes in `src/routes`.
- `apps/console` — the operator console (`bogey console`): a 127.0.0.1-only
  page on `@bogey/ui` that runs the CLI from a fixed list (ADR 0025).
- `bogey.config.ts` — this instance's name, logo, theme, disabled plugins.
  Hand-edited, never written to from the web UI. Secrets are in the root `.env`.
- `packages/config` — defines configuration: `defineConfig`, the settings
  registry (DB settings' schemas and defaults), the generated theme list.
- `packages/db` — Supabase client (`browser.ts`/`server.ts`/`admin.ts`),
  typed queries in `src/queries/`, generated `types/database.gen.ts`.
- `packages/plugins` — the plugin API (`api.ts`, `runtime.tsx`, registry).
  `bundled/<key>/` holds the plugins that ship with Bogey (`challenges`,
  tracked; ADR 0026); others go in `installed/<key>/`, which the repo ships
  empty (gitignored; ADR 0009). See [`docs/plugins.md`](docs/plugins.md).
  `installed/` may be a symlink to a separate repo: edits there aren't in
  this repo's git, and searches that respect `.gitignore` skip it.
- `packages/ui` — shared shadcn-based UI primitives, `@bogey/ui/components/*`.
- `packages/utils` — `@bogey/utils`, framework-free helpers with no runtime
  dependencies (identifier patterns in `keys.ts`). Anything two packages
  would otherwise each define goes here.
- `tools/runner` — the challenges runner: judges contest solutions in Docker
  sandboxes; plain Node, no dependencies, its own image.
- `tools/dev` — developer-only scripts (find-text) and the check that paths
  named in the agent docs exist. Not shipped.
- `tools/cli` — the `bogey` CLI. Run it with `vpr bogey ...`; commands are
  listed in [`docs/reference/cli.md`](docs/reference/cli.md) (generated).
  When you add or change a command, subcommand or flag, update the operator
  console too: `apps/console/src/server/commands.ts` (an entry, or
  `NOT_IN_CONSOLE` with the reason) and `docs/self-hosting/console.md`.
  `apps/console/tests/commands.test.ts` fails on a command it doesn't know.
- `tools/dev` — developer-only scripts (`find-text`) and checks on these docs:
  `tests/agent-docs.test.ts` fails when an agent doc names a path that
  doesn't exist. Not part of the CLI, so no console entry.
- `supabase/schemas` — the schema (RLS is the real authorization boundary);
  `supabase/migrations` holds the generated baseline.

## Finding UI text

UI text is translated: the English lives in `packages/config/src/messages.ts`
under message keys, and the same English often has several keys. When asked
to change something by its visible label ("Overview on the manage page"), run
`vp run find-text "<label>" --in <path part>` first. It prints each matching
key and every `file:line` that renders it, with the route's URL. Pass a key
instead of text to skip the lookup.

Name a new key after the surface that renders it. Don't reuse another
namespace's key because its English happens to match.

<!-- bogey CLI (commenting without ticks for search purposes) ^^^ -->

Full self-hosting/config/deploy detail: [`docs/self-hosting.md`](docs/self-hosting.md).

**See [`CONTEXT.md`](CONTEXT.md) for the Bogey Glossary.**

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Vite+ is the package manager. Never run pnpm, npm, npx or yarn

Everything a package manager does goes through `vp`, which pins and runs pnpm itself:
`vp install`, `vp add <pkg>` (`-D` for dev), `vp remove <pkg>`, `vp dedupe`, `vp update`,
`vp outdated`, `vp why <pkg>`, `vp dlx <bin>` instead of `npx`, `vp exec <bin>` for a local binary.
Calling `pnpm`, `npm`, `npx` or `yarn` directly is wrong here even when it seems to work: it bypasses
the pinned version (root `devEngines` refuses npm outright) and the catalog in
`pnpm-workspace.yaml`. When a tool's own docs say `npx foo` or `pnpm add foo`, translate it to
`vp dlx foo` or `vp add foo`. Suggesting a fix to the user? Write it with `vp` too.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
