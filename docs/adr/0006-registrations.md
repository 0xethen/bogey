# 0006: One registrations table replaces imports, signups and pending users

**Status:** accepted, 2026-09

## Context

There were three parallel rosters:

- `participant_import_rows` (CSV import)
- `signup_submissions` (invite links from the forms plugin), which never
  became memberships
- `pending_users` (review queue), unique per user across _all_ orgs and with
  `event_id` never set

Each had its own status field and its own admin screen.

## Decision

- **`registrations(event_id, email, user_id?, source, status, answers, ...)`**
  holds everyone who asked, or was asked, to take part. The `source` column
  says how they arrived: `import`, `link`, `self` or `invite`.
- **Forms.** `onboarding_forms` holds the event's question list, and
  answers are validated against it. `invite_links` carry an auto-approve
  flag, a capacity, a window and a default division.
- **Linking accounts.** When an auth user is created, a trigger links
  registrations by email. A registration that is approved and linked to a
  user becomes an `event_members` row automatically.
- **One admin screen.** People has three tabs: Registrations, Members and
  Roles.

## Consequences

- The forms plugin's signup links move into core, since signing up is not
  optional. The plugin keeps only its extra features, such as attendance.
- Org-level membership is created as a side effect of the first approved
  event membership (or an explicit org invite). There is no org-level
  pending queue.
