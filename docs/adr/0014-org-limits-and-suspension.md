# 0014: Per-org limits that platform admins can override; restricted and suspended orgs

**Status:** accepted (2026-10-03)

## Context

The hosted instance gives every org a hostname, email sent from the instance's
domain, storage, public pages and custom domains. Limits today are instance
settings only: events per org, owners and admins per org, participants per
event. There are no per-org overrides, and nothing stops one org from using
the instance's mail or storage freely or being taken offline when abused.

## Decision

- **Limits on every resource an org can consume:** events, owners and admins,
  participants per event, emails per day, storage bytes, maximum upload size,
  custom domains, and pending invite links. Sign-in and registration rates
  per IP stay with Supabase Auth's own limits, which Bogey documents.
- **Instance defaults, per-org overrides.** The `limits` namespace has
  instance defaults; a platform admin can override any of them for one org
  on that org's page in `/admin`.
- **Unlimited by default on a self-hosted instance**, so a single-org
  instance never hits one by accident. The hosted instance sets its own.
- **Enforced below the UI.** Counts are checked in the database (triggers and
  RPCs); email limits in the Send Email hook. The UI only shows usage.
- **Two states, set by a platform admin with a reason:**
  - **restricted:** members can sign in and read, but writes to the org's rows
    are refused by a trigger on every table with an `org_id` or `event_id`
    (a trigger, because an RPC bypasses RLS), and public pages stay up;
  - **suspended:** the org's hostname shows a suspended page and no mail is
    sent for it. Its data stays readable through the API by whoever may read
    it, so this stops abuse on the site and doesn't hide data.

  The reason is shown to org owners and recorded in the audit log.

- **Reporting:** public pages (galleries and invite pages) carry a "Report"
  button. Reports are stored and listed in Instance → Reports for platform
  admins to close; the database caps how many arrive per hour.
- **Storage limit is best effort.** The per-org storage cap is a trigger on
  `storage.objects` that counts the sizes Storage records, so it holds for
  uploads that record their size when they finish.
- **Platform admin actions need a second factor.** They require an `aal2`
  session (a TOTP or passkey through Supabase MFA), checked in the database,
  not only in the UI. Org owners may opt in later.

## Consequences

- The hosted service can be run without watching it constantly: abuse hits a
  limit or a switch rather than an outage.
- Platform admins must enrol a factor before using `/admin`.
- Every limit adds a column or setting that the database checks on write, so
  adding one costs a migration and a pgTAP test.
