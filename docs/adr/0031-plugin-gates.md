# 0031: Plugins can close an event to a participant

**Status:** accepted (2026-10-17). Changes part of [0023](0023-lockdown-integrity.md).

## Context

Lockdown's covers ("Full screen, please", "Open this event in Safe Exam Browser", a stopped participant's
notice) were drawn by its `eventWrapper` in the browser. The tabs stayed clickable, every page rendered
its own cover, and the event's data was still readable through the API by anyone who skipped the page.
Organizers expect a covered participant to see nothing but the cover.

## Decision

- **A gate is a SQL function.** A plugin closes the event to a participant by defining
  `private.<key>_gate(uuid)` returning a reason, or null when it is open. `private.event_gate(event)`
  asks every enabled plugin that has one and returns `<key>.<reason>` for the first that is closed.
  Only participants are gated: organizers, staff, judges and org admins always get through, so an
  organizer caught by a misconfigured plugin can still reach Manage.
- **A gated participant holds no permission.** `private.has_permission` is now what the person's roles
  grant (`private.holds_permission`, its old body) and the event's gate being open. Every policy and
  RPC that asks for a permission refuses them, without any of them knowing about plugins.
- **They can still read what the plugin needs.** `settings_for` and the `settings` policy return the
  `plugins` and `plugin.*` namespaces to anyone whose roles grant `event.view`, gated or not, so the
  plugin can draw its cover. A plugin's own RPCs that let someone back in check `holds_permission`.
- **The event route follows the gate.** Its `beforeLoad` asks `public.event_gate` on every navigation
  for participants and redirects anything but the event's home there; the tab row renders nothing
  while gated. A watcher reloads the event's queries and the router when the gate opens or closes.
- **Lockdown 1.1 gates on what it covers for**: not in full screen (as the page last reported, and only
  while its heartbeat is under three minutes old), the required browser not attested, or stopped with
  "Hide the event". Phones and tablets are turned away by the page only: a browser can claim to be a
  desktop.

## Consequences

- The cover is now a server boundary for everything the database knows. Full screen is still a report
  from the page: someone who calls `lockdown_heartbeat(p_fullscreen => true)` by hand opens the event for
  themselves, and each claim is in the audit log as `lockdown.fullscreen_entered`. Requiring Safe Exam
  Browser is the only setting a browser can't make up. ADR 0023's "a deterrent and a record" stands for
  that part.
- `has_permission` reads the event's `plugins` setting for participants, and calls each gate it finds.
  Policies wrap it in `(select ...)`, so that happens once per statement.
- Data a page read before the gate closed stays in the browser until the watcher refetches it (within
  a minute for a gate that closes on its own, at once when the page reports).
- A plugin that refuses its own participants for being gated (an RPC calling `has_permission`) can't let
  them back in; use `holds_permission` there.
