# 0021: Bogey's own email goes through an outbox the app drains

**Status:** accepted (2026-10-09). Builds on [0013](0013-email-templates.md) and
[0014](0014-org-limits-and-suspension.md).

## Context

Sign-in email is handed to the app by GoTrue's Send Email hook, so the app is always the one
sending. Bogey's other mail (registration decisions, invitations, assignments, reminders, results)
starts in the database: an RPC approves someone, or `pg_cron` notices a deadline. The database can't
speak SMTP, and a web request that sends mail inline makes a registration approval fail when the
mail server is down.

## Decision

- **An `email_outbox` table is the queue.** RPCs and triggers call `private.enqueue_email` (or
  `private.notify`, [0022](0022-notifications.md)) in the same transaction as the change, so a
  message exists exactly when the change committed. The table has no client policies.
- **The app drains it.** `pg_cron` calls `private.drain_email_outbox()` every minute; when mail is
  due, it POSTs to `<tenancy.appUrl>/api/email/drain` with `pg_net`. The route verifies an HMAC of
  the timestamp, claims batches with `FOR UPDATE SKIP LOCKED` through a service-role RPC, renders
  with the same context, layout and Markdown templates as sign-in mail, and sends over the same SMTP
  transport. Draining is idempotent and safe to run twice at once.
- **The secret is the database's own.** The first brief assumed the existing hook secret, but that
  one lives in the app's environment, which the database can't read. The schema creates a random
  Vault secret (`bogey:email-drain`) and the app reads it with the service role, so there is nothing
  to configure beyond the app's address.
- **Limits and suspension apply per message** through `record_email_send`, the same counter the
  hook uses: over the daily limit or a suspended org marks the row `skipped` with the reason.
- **Retries back off** (1, 4, 16, 64 minutes) up to five attempts, then `failed`. A claim is a
  ten-minute lease, so a drain that died mid-send is picked up again.
- **Unsubscribe is built in.** Mail a person can switch off carries a signed one-click link
  (`List-Unsubscribe`, `List-Unsubscribe-Post`) that turns that kind's email off in their
  preferences. Mail about a person's own registration is transactional and has none.
- **Kinds are a registry**, extending 0013's: Bogey's own kinds and plugins' `<key>.<kind>`
  kinds, all editable at instance, org and event level.

## Consequences

- An instance needs `tenancy.appUrl` for queued mail to flow; Instance → Overview shows the queue
  length, its age and the last error, so a missing address is visible.
- Delivery is at least once. A crash between sending and recording would resend; accepted for
  mail that is informational or idempotent.
- The app must be reachable from the database. Supabase Cloud reaches a public URL; a local stack
  uses `host.docker.internal`.
