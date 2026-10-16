# 0030: One About, for members by default

**Status:** accepted (2026-10-16). Changes part of [0028](0028-event-privacy.md).

## Context

ADR 0028 kept About (`events.description_md`) public so people could decide to register, and added a
second, members-only text for participants (the `briefing` setting, "For participants" in Details and
on the home). Organizers then had two boxes that both read as "about the event", and had to remember
which one was public. Public text already had a home that says so: the homepage's Text blocks.

## Decision

- **One About.** The `about` setting (`body`, Markdown) is the event's About, edited in Manage → Details
  and shown by the home's About block. `briefing` and its block are gone, and so is
  `events.description_md`.
- **Members only unless shared.** About is a privacy section like the agenda: `privacy.about` is
  `members` by default, and `public` shares it with anyone who can see the event. `settings_for` and the
  `settings` policy return `about` through `private.section_open(event, 'about')`, so the database
  enforces it. Applicants and the waitlist see that there's more once they're approved.
- **Public text goes in a Text block.** The Details field says so.

## Consequences

- The `about_for_members` migration moves each event's old About in front of its For participants text.
  Events that only had a public About get `privacy.about = public`, so nothing that was public hides;
  events that had both start members-only. A home's For participants block becomes About, or goes if
  the page already has one.
- The public API's `description` is About when it's shared, and empty otherwise. Link previews and
  feeds never used it.
