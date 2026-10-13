# 0011: Releases are tags; instances follow tags; the baseline freezes at 2.0.0

**Status:** accepted (2026-10-03)

## Context

Bogey has one long-lived branch of work and no tags. `bogey upgrade` merges
`upstream/main`, so an instance can pick up half-finished work. The schema
baseline is regenerated freely, which is fine before a release and harmful
after one, because a self-hoster's database can't be regenerated.

## Decision

- **`main` is always releasable.** Work happens on short-lived branches and
  pull requests, with CI required before merge. There is no long-lived
  development branch.
- **Releases are SemVer tags** (`v2.0.0-rc.1`, `v2.0.0`) published as GitHub
  Releases. The notes come from `CHANGELOG.md`, including **Upgrade notes**.
- **Instances follow tags, not `main`.** `bogey upgrade` merges the latest
  release tag of `upstream`, or a tag given with `--to`.
- **The baseline freezes at 2.0.0.** Before 2.0.0 it may be regenerated. After
  it, the baseline is never rewritten and every schema change is a new
  migration in `supabase/migrations/`.
- **What SemVer covers:** the schema and its migrations, the plugin API
  (`PLUGIN_API`), the CLI's commands and flags, and the shape of
  `bogey.config.ts`. A breaking change to any of them is a major version.
  Additive plugin API fields are minor and don't change `api`; `api` is an
  integer that only increases when something is removed or changes meaning.
- **Releases are immutable and attested.** The repository turns on GitHub's immutable releases,
  so a published release's tag and assets are fixed and GitHub signs a release attestation;
  the workflow also attests the source archive and the image's build provenance.
  `bogey upgrade` checks the release with `gh` before merging its tag and warns when it
  isn't attested (`--require-verified` refuses).
- **An image is published per tag** to `ghcr.io/0xethen/bogey`, with build
  provenance. Instances that need plugins or their own themes build from the
  tag through a small instance template repo (compose, `bogey.config.ts`, plugin
  lockfile, Dockerfile). Everyone else runs the image with config mounted.
- **License:** Apache-2.0, replacing the Unlicense, with a `NOTICE` file.
- **No telemetry.** The update check (Instance → Overview, Instance →
  Plugins) is a plain request to the GitHub Releases API with no instance
  data. It can be turned off in `bogey.config.ts` or `.env`.

## Consequences

- Moving `main` forward never breaks an instance by itself; only a tag does.
- Pre-2.0.0 databases must be reset once; after that, upgrades are migrations.
- Every release needs a changelog entry, written for the person running an
  instance.
