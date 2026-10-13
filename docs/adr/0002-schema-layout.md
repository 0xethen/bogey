# 0002: `public`/`private` schemas, declarative schema files, a single baseline

**Status:** accepted, 2026-09

## Context

The old schema problems:

- The schema grew over 56 migrations, several of which redefined the same
  functions, so the only way to learn the current shape was to replay them
  all in your head.
- Helpers lived in a `bogey` schema the Data API couldn't reach, so each one
  needed a `public.*` wrapper. One wrapper ended up running with the
  caller's rights and quietly broke auto-submit.

We are wiping the database anyway, so there is no history to keep.

## Decision

- **`supabase/schemas/NN_<domain>.sql`** is the source of truth, one file
  per domain. Plugin SQL lives in `supabase/schemas/plugins/<key>.sql`.
  Migrations are generated with `supabase db diff` and committed. The first
  one is a single baseline.
- **`public`** holds tables (with RLS on every one) and the RPCs clients are
  meant to call. **`private`** holds helpers used by policies and triggers.
  `private` is granted `usage` but never exposed through the API, so policies
  can call its functions and clients can't.
- **Tests.** pgTAP tests live in `supabase/tests/` and run in CI against
  `supabase start`.

## Consequences

- To read the schema, read one file per domain.
- After the first public release, generated migrations are append-only, as
  before. The declarative files keep changes reviewable as diffs of the
  current shape.
- The old migrations remain in git history only.
