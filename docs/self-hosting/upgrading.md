# Upgrading

How you upgrade depends on how you run Bogey.

- **The published image** (the [all-in-one](all-in-one.md) compose, or the image with your own Supabase):
  read the release's CHANGELOG, set the image tag, apply migrations, restart.

  ```sh
  docker compose pull
  docker compose up -d          # all-in-one: `migrate` applies the schema before `web` starts
  ```

  With your own Supabase, run `docker compose run --rm web bogey db migrate` (and
  `bogey plugins migrate`) first, from the new image.

- **An instance repository** (the template in `deploy/instance-template`): change `BOGEY_VERSION`, build,
  migrate from the new image, start. Its README has the commands.
- **A fork of Bogey**: `bogey upgrade`, below. This is for people who change Bogey's code.

## Upgrading a fork

Instances that fork Bogey upgrade by merging upstream into theirs.
`bogey upgrade` does the whole thing in order and stops at the first problem:

```sh
git remote add upstream https://github.com/0xethen/bogey.git   # once
bogey upgrade --db-url postgres://...   # --dry-run to see the steps first
```

1. **Checks the working tree is clean.** Commit or stash your own changes first.
2. **Backs up** Storage, and the database's data with `--db-url`
   (`bogey backup`; `--skip-backup` if you just took one).
3. **Merges** the latest release of `upstream`: the newest `v<major>.<minor>.<patch>`
   tag, so an instance never picks up half-finished work. `--to v2.1.0` picks a
   tag, `--pre` allows prereleases, and `--branch main` follows a branch instead
   (for people developing Bogey). On conflicts it stops and lists the files.
   Resolve them, `git commit`, and run it again; it carries on from where it
   stopped.
4. **Installs** dependencies (`vp install`).
5. **Applies migrations** (`bogey db migrate`). Without `--db-url` it tells
   you to run them yourself, or use `supabase db push`, before the new app
   starts. Running a new app against an old schema is the most common way an
   instance breaks after an update.
6. **Regenerates** the theme list and checks the setting defaults.
7. **Runs** `bogey doctor`.
8. **Prints** what `CHANGELOG.md` gained, including any upgrade notes.

Then rebuild and restart: `docker compose -f deploy/compose.yml up -d --build`.

## Verifying a release

Releases are published as GitHub [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases):
once one is out, its tag and files can't be changed, and GitHub signs an attestation for
it. Each release also carries a source archive and a container image whose build
provenance is attested by the workflow that made them. You need the GitHub CLI
(`gh`, signed in) to check any of it:

```sh
gh release verify v2.0.0 --repo 0xethen/bogey                                   # the release attestation
gh release verify-asset v2.0.0 bogey-2.0.0.tar.gz --repo 0xethen/bogey          # a downloaded asset is part of it
gh attestation verify oci://ghcr.io/0xethen/bogey:v2.0.0 --repo 0xethen/bogey   # the image's provenance
```

`bogey upgrade` runs `gh release verify` on the tag it's about to merge and tells you the
result. A release without an attestation is a warning, not a stop; pass
`--require-verified` to refuse one.

## Migrations

Schema changes ship as files in `supabase/migrations/`, applied oldest first
and never edited once released. `bogey db status --db-url ...` shows which ones a
database has applied; `bogey db migrate` applies the rest, each in its own
transaction. Both use the table the Supabase CLI keeps, so `supabase db push`
and `bogey db migrate` agree about what's applied.

Instance → Overview warns when the database is behind the app (or ahead of
it), and `bogey doctor` does too when `DATABASE_URL` is set. It also says when
a newer Bogey release is out, read from `upstream` in `bogey.config.ts`
(Bogey's own repository unless you set another).

A database set up by hand (pasting the baseline into psql) has no record of
what it applied. Once it matches the app, record that once:

```sh
bogey db mark-applied --all --db-url postgres://...
```

Before the first release the schema is a single baseline that's rebuilt in
place (see [ADR 0002](../adr/0002-schema-layout.md)), so an upgrade that
changes it leaves an existing database behind without a migration to catch it
up. `bogey db repair` does that (below). The first release freezes it
(`bogey db freeze v1.0.0`); from then on every schema change is a new
migration, and CI checks that a database at the last release upgrades cleanly
and passes the tests.

## Repairing a database

`bogey db repair` brings a database's core schema in line with `supabase/schemas`:
for one set up by an older Bogey before the first release, or one that drifted
because someone changed it by hand.

```sh
bogey db repair --db-url postgres://... --dry-run   # what's missing, changing nothing
bogey db repair --db-url postgres://...
```

It creates missing tables and enum types, adds missing columns and enum values,
and re-applies every function, view, trigger, policy, index, grant and cron job.
It also brings existing tables' check, foreign key and unique constraints in line:
ones the schema dropped or changed are dropped, new ones added. A check or foreign
key that existing rows break holds for new rows only, and repair warns so you can
fix those rows and rerun. It never drops a table, column or row: columns the schema
doesn't know about are listed and left alone. Everything but new enum values runs in one transaction, so a failure
changes nothing and names the statement that failed. Two things it can't do on
its own: add a `not null` column without a default to a table that has rows (the
dry run warns), and change a function's return type (drop the function, then
rerun). After a release, run `bogey db migrate` first; repair fixes drift, while
migrations also carry data changes. Plugins' tables come from their own
migrations (`bogey plugins migrate`).

## Changing the schema yourself

Edit `supabase/schemas` (the source of truth). Before the first release, run
`bogey db baseline`. After it, add a migration with
`bogey db migration <name>`: with a local Supabase running it's generated by
`supabase db diff`; otherwise you get an empty file to fill in. See
[Contributing](../contributing.md#changing-the-schema).
