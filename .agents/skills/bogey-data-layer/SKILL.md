---
name: bogey-data-layer
description: Bogey (hackathon platform) database and packages/db conventions — RLS as the boundary, RPC-only writes with audit, permissions and "view as", server functions and DbResult, schema workflow and tests. Use when editing supabase/schemas, supabase/tests or packages/db/src.
---

# Bogey data layer conventions

## The boundary is the database

- RLS decides what anyone can read or write. App checks (`can`, route guards,
  hidden buttons) are UI only. A new table gets RLS and its policies in the same
  change.
- Policies call `private.*` helpers (`has_permission`, `can_manage`,
  `window_open`, `event_role`, `my_team`, `hides_team_names`, `gallery_open`...),
  wrapped as `(select private.x(...))` so they run once per query. Each helper
  is `security definer`, `set search_path = ''`, and granted to the roles whose
  policies call it (anon too, for anything a public page reads).
- Writes that touch more than one row, need checks RLS can't express, or must be
  audited go through a `public` `security definer` RPC that checks its caller
  first (`private.can_manage`, a permission, a window) and calls
  `private.audit(event, action, target_type, target_id, meta)`. Every such RPC is
  listed with a reason in `packages/db/tests/rpc-surface.test.ts`.
- Tables people edit directly (events, settings, event_members, teams, forms,
  org_members) are audited by triggers in `11_audit.sql`, only when there's a
  session. Never put values that may be long or secret in `meta`; it's capped at
  4 KB.
- Core audit actions, permissions and `check (column in (...))` values are generated
  from `supabase/schemas` into `packages/db/src/types/schema.gen.ts` (`bogey types
  --schema`, or `bogey watch --schema`). A new action needs a label in `ACTION_LABELS`
  (`packages/db/src/audit.ts`) or type checking fails. Plugins log `<key>.<action>`.

## Schema workflow

- `supabase/schemas/NN_<domain>.sql` is the source of truth. Before the first
  release, `bogey db baseline` rebuilds the single migration; after
  `bogey db freeze`, changes are new migrations (`bogey db migration <name>`).
- pgTAP tests in `supabase/tests/database/` run with `begin ... rollback`. Scope
  every count and `select` to the test's own event or org (`where event_id =
  tests.u('ev')`): the dev database has real rows, and public ones are readable
  by test users.
- After a schema change, unless told not to:
  1. `vpr bogey db repair --yes` applies it to the dev database (`DATABASE_URL` in
     `.env`; `--dry-run` first if unsure). It never drops, so a removed column or
     table stays; say so rather than dropping it by hand.
  2. Run the pgTAP suites.
  3. Regenerate types (`vpr bogey types --db-url ...`, from any database with the
     current schema; never by hand, CI checks it; `docs/contributing.md#generating-types`).
  4. If `supabase/RELEASED` exists (a release has shipped), add a migration
     (`vpr bogey db migration <name>`); otherwise rebuild the baseline
     (`vpr bogey db baseline`, offline).
- Schema-file `do` blocks must stay rerunnable, or `repair` breaks.

## Permissions (`packages/db/src/permissions.tsx`)

- Named permissions (`event.manage`, `judging.score`, `sessions.attendance`), not
  role ranks. `EventAccess` holds the role, `orgAdmin`, the grants (core role
  plus plugin role grants) and the role matrix for previews; `can(access, name)`
  answers in the UI.
- Access is resolved once in the event route's `beforeLoad`, so loaders can
  redirect before render.
- "View as" (`useViewAs`, `previewAccess`) only narrows: preview grants are
  intersected with real ones. It's a session cookie (`packages/db/src/view-as.ts`)
  that both Supabase clients send as `x-bogey-view-as`, and the access helpers
  in `01_access.sql` (`event_role`, `org_role`, `holds_permission`,
  `is_platform_admin`) answer as the previewed role for someone who manages the
  event. So RLS and RPCs need no preview logic of their own; use the `real_*`
  helpers only where previewing must not apply (plugin gates). Pages that check
  a real role (Team, Submission) can't be previewed.

## Server functions (`packages/db/src/queries/*`)

- `createServerFn` with a `.validator` that parses `unknown` input with the
  helpers in `validate.ts` (`requireId`, `requireText`, `requireOneOf`...), and a
  handler returning `DbResult<T>` (`ok`, `fail`, `toFailure`). Query options
  `unwrap` it; mutations in components use `unwrap` or `requestFailure`.
- Don't restate RLS in queries: reading through the user's client already
  returns only what they may see. Filter explicitly only when a policy is
  broader than the screen (an organizer's own picks among everyone's).
- Don't export plain server-side helpers from modules the browser loads; keep
  them module-private and expose server functions.
- A field typed `unknown` in a return value widens the whole `DbResult`; parse
  `Json` columns into real types (`jsonRecord`, zod for nested shapes).
- Core's generated types leave plugin tables out. A plugin declares its own schema's
  `Database` type and reads through `browserClientFor<ItsDatabase>()`
  (`@bogey/db/browser`): the same browser client and session, under RLS.

## Auth (`packages/db/src/auth.ts`)

- The session carries `user`, `profile`, the host's `org`, `orgRole` and
  `platformAdmin`. Read it with `useSession()` in chrome and route context in
  pages.
- Sign-in is a code or a magic link. A magic link's code is exchanged in
  `__root.tsx`, so it works even when GoTrue rewrites the redirect to the site
  root; the destination is kept in a cookie, not the link.

## Judging

- `private.rank_submissions` ranks in SQL: each criterion's average mapped from
  its `min_score..max_score` range to 0..1 (clamped), weighted, per form and per
  division. Results are published as a snapshot in `result_publications`.
- Blind judging hides `teams` from judges (`hides_team_names`), even while the
  public gallery is open. Items with `namesPeople` stay collapsed for judges
  until revealed.
