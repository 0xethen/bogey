# 0026: Challenges ships with Bogey; finding a team is core

**Status:** accepted (2026-10-11). Partly supersedes [0009](0009-plugins-ship-separately.md).

## Context

ADR 0009 kept every plugin out of this repository so a fresh clone is core only. Two things wore
on that rule. Programming contests and capture the flag (the `challenges` plugin) are one of
Bogey's main formats, with a runner image, a CI job and demo seeds; keeping them in another
repository meant every instance had to install, pin and migrate them separately, and their SQL
went untested next to the core it depends on. And the team-matching plugin (a looking-for-a-team
board and an organizer's matcher) is something most hackathons need, built only from core tables.

## Decision

- **Bundled plugins.** `packages/plugins/bundled/<key>/` holds plugins that ship with Bogey and
  are tracked in git. Today that is `challenges`. A bundled plugin is still a plugin: the same
  manifest and runtime, the same API version, off until an org or event turns it on, and
  `plugins.disabled` still switches it off for an instance. It versions with Bogey, so it has no
  release tags or lock entry of its own, and `bogey plugins add` refuses its key.
- **Everywhere installed plugins are read, bundled ones are too:** the app's registry (bundled wins
  a key clash), every `bogey plugins` command, `doctor`, `seed demo`, the image (`packages/plugins/bundled`
  is copied beside `installed`) and the CSS source scan.
- **Its SQL is part of Bogey's schema.** `bogey db migrate` and `bogey reset` apply bundled plugins'
  migrations after core's, so no deployment path can leave them out. They stay plugin migrations
  (`supabase_migrations.plugin_migrations`), not part of the baseline, because the plugin can be
  disabled. CI runs their pgTAP after core's.
- **The runner** moved to `tools/runner` (a workspace package with no runtime dependencies) and its
  images publish with Bogey's own release tags.
- **Finding a team is core.** The board (`team_seekers`, `team_openings`, `team_requests`), its
  RPCs, notifications (`team.request`, `team.invited`, `team.answered`) and the matcher
  (`@bogey/utils/team-matcher`) are part of Bogey. The Team page shows the board while teams are open
  and the event setting `teams.board` is on (default); Manage → Teams has **Match teams...**
  whatever that setting says.
- Other judging methods stay one plugin, `extra-judging` (pairwise, peer rating, ranked ballots,
  points budget), as [0020](0020-ranking-providers.md) intends.

## Consequences

- A fresh clone has one plugin. The core pgTAP suite still runs without it; the bundled plugin's
  tests run after `db migrate`.
- Moving a plugin into `bundled/` is the way to make one part of Bogey without making it core.
  Moving it out again needs a lock entry and a release, like any installed plugin.
- An instance that installed `challenges` from the plugins repository keeps its data: the key, tables
  and migration names are the same. `bogey doctor` asks it to drop the lock entry.
