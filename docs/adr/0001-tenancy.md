# 0001: One database, orgs as tenants, resolved from the host

**Status:** accepted, 2026-09

## Context

Bogey is self-hosted, usually by one organization. There will also be a
hosted testing period where many orgs share one deployment at
`<org>.bogey.ethen.app`. The old schema was half multi-tenant, and it failed
in three ways:

- `current_org()` fell back to "the only org", even for visitors who weren't
  signed in.
- Some policies checked "admin of _any_ org".
- `profiles.org_id` pinned each user to one org.

## Decision

- **One Supabase project with many orgs.** A self-hosted instance is simply
  the case where there is one org.
- **Resolving the org.** The web server maps the request's Host header to an
  org through `org_domains`. When nothing matches, it falls back to the
  instance setting `tenancy.defaultOrg`. Every query then passes that org or
  event explicitly. There is no JWT claim for the "current org".
- **The tenancy chain.** Org-level tables carry `org_id`. Event-level tables
  carry `event_id`, and an event's org never changes. Deeper tables use
  composite foreign keys on `event_id`, so a row can never point at a parent
  in another event (and therefore another org).
- **Users are global.** `auth.users` and `profiles` belong to the instance,
  and a user can be a member of several orgs. Visibility of profiles is
  scoped to the orgs two users share.
- **Signup.** The `before_user_created` hook reads the target org from the
  signup metadata and applies that org's registration policy.

## Consequences

- Isolation is tested once, in CI (pgTAP, two orgs), instead of being
  assumed.
- One user can use the same email address across orgs. That is expected;
  their memberships stay separate.
- Supabase auth settings are per project, so SMTP sender and email templates
  are shared across orgs on the hosted instance. The templates are branded
  from org settings through template variables where possible.
- The alternative, one Supabase project per org, was rejected for the
  hosted period because it multiplies both cost and operations work.
