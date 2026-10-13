# 0010: Sessions: an agenda of time slots, written only through RPCs

**Status:** accepted (2026-10-01)

## Context

The schema had "subevents": blocks of sessions a participant picks one of, with
attendance stored on the pick. There was no UI. Events need more than that: an
agenda with things everyone attends (check-in, opening, lunch, the award
ceremony), rounds where people choose one workshop, hosts who take attendance,
and a per-person view of who missed what.

## Decision

- **Name.** The domain word is _session_. A **slot** is a span of time that is
  either `everyone` (on everyone's agenda, no sign-up) or `choose` (sign up for
  one session). Tables: `session_slots`, `session_categories`, `event_sessions`,
  `session_hosts`, `session_signups`, `session_attendance`, `session_codes`.
  `event_sessions` avoids a bare `sessions` next to `auth.sessions`.
- **Sessions are generic.** `kind` is free text checked against a key pattern
  (`talk`, `workshop`, `meal`, ...; plugins use `<plugin>.<kind>`), so new kinds
  need no migration. A session can have its own times inside its slot, hosts
  who are event members and a free-text `host_note` ("Amazon"), a capacity,
  `required`, `takes_attendance` and `visibility` (`everyone` or `staff`).
- **Categories belong to the event and to a session kind**, not to a slot: a
  Workshop can have Beginner, Advanced and Masterclass while a Talk has none, and
  the levels repeat across rounds. A session keeps only a level its kind lists.
- **Attendance is its own table**, not a column on the sign-up: for-everyone
  sessions have no sign-ups, and walk-ins attend without one. People check in
  with a six-character code shown in the room (`session_codes`, never readable
  by participants) within 30 minutes of the session's times, or hosts and staff
  tick them off a roster.
- **Writes go through security-definer functions** (`save_agenda`,
  `choose_session`, `leave_session_slot`, `set_attendance`, `session_code`,
  `check_in_session`), each checking the caller and writing an audit entry.
  The tables only have select policies. `save_agenda` replaces the whole agenda
  in one transaction, like `save_criteria`, so the editor is one form on the
  save bar.
- **One read for participants**: `event_agenda` returns the visible agenda with
  seat counts and the caller's own picks and check-ins as JSON, parsed with zod
  in `@bogey/db/queries/sessions`.
- **Window**: sign-ups use the `sessions` window ("Session sign-ups"). The
  `subevents.attendance` permission became `sessions.attendance` (staff).

## Consequences

- Moving a session to another slot carries its sign-ups along
  (`on update cascade`); a slot that becomes for-everyone drops its sign-ups.
- Deleting a session in the editor deletes its sign-ups and attendance; the
  editor says so before saving.
- Plugins can add session kinds without core changes, but can't yet add fields
  to a session (see the plugins review).
