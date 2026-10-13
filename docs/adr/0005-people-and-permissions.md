# 0005: Event roles plus a permission matrix; judges aren't participants; teams are always the entrant

**Status:** accepted, 2026-09

## Context

Roles were modeled three times:

- the org role and event role, merged with `greatest()`
- a UI permission table that looked only at the org role, so judges who
  were judges only for one event couldn't score in the UI
- plugin roles that the UI honored and RLS ignored

Other problems:

- Judges were participants, so they saw the participant dashboard.
- Solo and team contests had separate code paths (`solo_only`, `is_solo`,
  nullable `team_id`).

## Decision

- **Org roles** are `owner`, `admin` and `member`. **Event roles** are
  `participant`, `staff`, `judge` and `organizer`, and each event member has
  exactly one. Plugin roles (`checkin.desk`) are granted on top of that
  through `event_role_grants`.
- **`roles`** holds every role's key and the label people see (`participant`,
  "Participant"). Core keys are plain; a plugin's are `<plugin>.<role>`, with
  its key in `source`. The UI reads labels from here and keeps none of its own.
- **`role_permissions`** maps roles to permission strings. Core rows live in
  the schema and plugin rows in each plugin's SQL.
  `private.has_permission(event, perm)` is the one check RLS uses. Org
  owners and admins have every permission on every event in the org.
- **The TypeScript permission list is generated from the table.** The UI's
  `can()` asks the same question RLS does. "View as" preview can only narrow
  what you're allowed to see.
- **Every competitor is on exactly one team per event**, enforced by
  `unique (event_id, user_id)` on `team_members`. In solo events the team
  of one is created automatically. Solutions, submissions and clarifications
  all reference `team_id`.

## Consequences

- A judge who wants to compete in the same event can't. That is
  intentional; use two events or give them a different role.
- Permission changes are schema changes, reviewed like any other.
