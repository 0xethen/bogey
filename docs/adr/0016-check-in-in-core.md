# 0016: Check-in is part of Bogey, not a plugin

**Status:** accepted (2026-10-09). Replaces the earlier plan to ship check-in as a plugin
(see [0008](0008-plugin-data.md) and [0005](0005-people-and-permissions.md), which mention the
`checkin` plugin and its `checkin.desk` role).

## Context

Check-in began as a plugin: a desk page that marked people as arrived. In practice every in-person
event wants it, it needs to reach into core (hold participants back until they arrive, show on the
people list, export with the roster, print badges), and a plugin can't change the rules of the
tables it doesn't own.

## Decision

- **Core tables and RPCs.** `checkins`, `member_codes` and the RPCs `check_in`, `undo_check_in`,
  `check_out`, `check_in_walk_in`, `my_badge`, `badge_sheet`, `checkin_roster`, all audited.
- **One permission, `people.checkin`,** granted to staff (organizers and org admins hold it
  implicitly). Participants read only their own row.
- **A badge is a code, not a document.** Each member gets a random eight character code on first
  use. The QR holds only that code; scanning it asks the database who it is, so a leaked badge
  grants nothing but a check-in.
- **Self check-in uses a code that rotates.** The venue code is derived from a Vault secret and the
  current ten-minute period, shown to staff only, so it can't be read from settings or guessed
  from outside the room.
- **Requiring check-in is enforced in the database.** `private.check_in_ok` is called where
  participants write: team changes, submission edits and votes. It only applies to participants.
- **Walk-ins register first.** An email off the roster is approved as a registration and checked
  in if the account exists; otherwise the person is checked in the first time they sign in.

## Consequences

- Instances that installed the old plugin can drop it; its data isn't migrated (the plugin never
  shipped a release).
- The desk needs the camera permission for scanning; typing a code always works.
- `checkin` is now a core settings namespace and window key, and the plugin API no longer lists
  check-in as an example of an event type.
