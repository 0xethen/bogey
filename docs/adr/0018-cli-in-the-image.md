# 0018: The CLI ships inside the image

**Status:** accepted (2026-10-10). Follows [0017](0017-runtime-instance-config.md).

## Context

Every operator task (applying migrations, creating the first org, backing up, checking the
instance) was a `vpr bogey` command in a checkout of the repository. An instance that runs the
published image, or builds one from an instance repository, has no checkout and shouldn't need one.

## Decision

- **`bogey` is a command in the image.** The CLI is bundled into one file with its workspace
  dependencies (`vp pack`), installed at `/opt/bogey/cli` with a `bogey` script on the `PATH`, next to
  `postgresql-client` for `db`, `plugins migrate` and `backup`. Run it with
  `docker compose exec web bogey ...`.
- **`BOGEY_HOME` stands in for the checkout.** The image sets it to `/app`, which holds the
  migrations, the schema files (for `repair`), the installed plugins and `bogey.config.ts`.
  `findRepoRoot` falls back to it when no workspace is found.
- **Commands that can't work say so.** Authoring commands (`db baseline`, `themes`, `types`,
  `release`, `docs`, `watch`) need source. `upgrade`, `restart` and `stop` control the host, which a
  container must not; they print the host commands instead. Which is which is in one table
  (`lib/image.ts`) that the CLI reference is generated from.

## Consequences

- The image grows by `psql` and a few hundred kilobytes of CLI.
- A new command has to be listed in `WHERE`, or a test fails.
- Operators of a checkout see no change.
