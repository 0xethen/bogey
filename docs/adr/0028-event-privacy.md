# 0028: Seeing an event is not being in it

**Status:** accepted (2026-10-12). About and For participants were merged into one members-only About by [0030](0030-about-for-members.md).

## Context

Every event table was readable by whoever could see the event (`private.can_view_event`): anyone for a
public event, any org member for an unlisted one. An applicant waiting for review saw exactly what a
stranger saw, and that included the whole agenda (rooms, host notes, who hosts), tracks and prizes, and
anything an organizer wrote into About, which the editor suggested using to reveal the theme. The
`event_agenda` RPC returned host names to signed-out callers even though `session_hosts` was
members-only.

Org membership made it worse. A trigger added everyone approved for any event to `org_members` for
good, so last year's participants could list this year's unlisted events, read every profile in the
org (`shares_org`), list the org's members and read its non-public settings.

## Decision

- **Two levels inside an event.** `private.can_view_event` answers "can they see the event exists and
  its public face"; `private.section_open(event, section)` answers "can they see this part": members
  (anyone with `event.view`) always, others only when the event's `privacy` setting shares that
  section. Sections are `agenda` (members only by default) and `tracks` (shared by default). About and
  the dates stay public so people can decide to register.
- **What's for participants has its own place.** The `briefing` setting (Manage → Details → For
  participants) is never public; the home shows it under About to members and tells applicants and the
  waitlist there's more once they're approved.
- **Participants aren't org members.** Only staff, judges and organizers join `org_members` when they
  join an event. Profiles are visible to people sharing an active event, to that event's people-viewers
  and the org's admins (`private.can_see_profile`), not to the whole org. The popular vote's widest
  audience is "anyone signed in" rather than "anyone in the org".
- **Unlisted means "has the link".** `public.open_event(org, slug)` remembers a signed-in visitor of an
  unlisted event in `event_visitors`, and `can_view_event` lets visitors, registrants and org members
  see it. Selecting from `events` directly can't enumerate unlisted events someone was never sent.

## Consequences

- An organizer who wants the agenda public before approval turns it on in Manage → Security → Before
  approval. Events from before this decision were set to share their agenda, as they did.
- Signed-out visitors can't open an unlisted event; they sign in first, as every event page already
  required.
- `events.location` stays public with the rest of the row; directions and online links (`venue`) were
  already members-only.
