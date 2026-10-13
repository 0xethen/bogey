# 0013: Email is a layout plus Markdown content per kind, edited in the app

**Status:** accepted (2026-10-03). Builds on the Send Email hook described in
`docs/self-hosting/email.md`.

## Context

There are two templates (`signIn`, `emailChange`), written as plain text, with
a simple generated HTML version. Supabase sends more kinds, Bogey will send its
own (registration decisions, invites, assignments), and any org can write the
text of mail that comes from the instance's domain. Raw HTML from an org on a
shared instance makes phishing from that domain easy.

## Decision

- **Email kinds are a registry.** Each kind has a key, a label, the variables
  it offers and the ones it requires (`{{code}}` or `{{link}}` for sign-in
  mail). Core registers the Supabase auth kinds that can fire (sign-in, sign-up,
  invite, recovery, email change, reauthentication) and Bogey's own mail.
  Notification kinds for features Bogey doesn't have (passwords, MFA) are not
  listed until the feature exists. Plugins registering kinds is planned and
  not built yet.
- **The instance owns one HTML layout.** Header, logo from branding, footer,
  and a `{{content}}` slot. HTML is the default editor at this level; Markdown
  is available too.
- **Content is Markdown.** Each kind's subject and body are Markdown with
  variables, rendered into the layout. Markdown is the only content path for
  orgs and events, so there is one rendering path to secure. The plain-text
  version is generated from the same source.
- **Orgs override content, never the layout.** The footer, which names the
  platform and says the message was sent on behalf of the org, is part of the
  layout and can't be removed.
- **Override levels:** instance, then org, for auth mail (the event isn't known
  at sign-in). Event mail adds an event level. Blank falls back to the next
  level up, then to Bogey's defaults.
- **Stored as Markdown.** Only the source is stored; rendering happens at send
  time, so a layout change applies to every template.
- **Locale:** templates are keyed by kind and an optional locale. Core uses the
  empty locale; the `i18n` plugin adds others.
- **Editor:** live preview, "send a test to me", a variables panel, and saving
  blocked while a required variable is missing.
- **Sending is limited per org** ([0014](0014-org-limits-and-suspension.md)).
- **The hook is the supported path.** Email settings shows whether the hook
  called in recently, and says in plain words when GoTrue is sending mail
  itself: edits made in the app then don't apply. The local `supabase start`
  templates stay as the fallback for development.
- **No restart for template edits.** The hook reads settings on every send.
  Only GoTrue's own environment (hook URL, secret, SMTP) needs a restart.

## Consequences

- Orgs can't send arbitrary HTML, links in content are their own to choose but
  the layout and footer are the instance's.
- Changing the layout is an instance-owner act and affects every org's mail.
- A stored template can refer to a variable that a later version of Bogey
  removes; the editor flags those, and sending falls back to the default.
