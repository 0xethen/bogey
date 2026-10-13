# 0022: Notifications are a core table; email is one channel

**Status:** accepted (2026-10-09). Builds on [0021](0021-email-outbox.md).

## Context

Announcements reach people inside the app, but nothing else does: a judge isn't told they were
assigned projects, a team isn't told a member joined, a plugin has no way to speak to anyone.
Each feature would invent its own banner and its own email.

## Decision

- **A `notifications` table is the bell.** One row per person: kind, title, Markdown body, a link
  inside the app, `read_at`. People read, mark read and delete their own rows; nothing else about a
  row changes. It is in the realtime publication, so the bell updates live.
- **`private.notify` is the only writer.** It takes recipients, event, kind, title, body, link and
  email variables. Per recipient it applies the kind's defaults and the person's saved choice
  (`user_preferences`, namespace `notifications`), writes the bell row and queues the email.
- **Kinds are a registry in TypeScript** (`packages/config/src/notifications.ts`) with a label,
  default channels and whether the email is transactional. `bogey db baseline` copies it into SQL, so
  the database and the settings screen can't disagree. Transactional kinds (registration status)
  always email; the rest follow the person.
- **Plugins declare kinds in the manifest**, namespaced `<key>.<kind>`, and send through the
  `notify_event` RPC, which checks the plugin is on for the event, that the caller holds one of the
  plugin's own permissions (or `event.manage`), and that recipients are members of the event.

## Consequences

- One place decides who hears what; adding a notification is a registry entry plus a `notify` call.
- A plugin can notify, but only people already in the event, only if its sender has a
  permission, and with a per-hour ceiling.
- Notifications older than 180 days are pruned daily.
