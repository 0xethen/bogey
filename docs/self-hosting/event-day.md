# Event day

What to check before a few hundred people arrive at once, and what to do when something gives. The numbers below are for an event of 250 people (participants, judges and staff together); `bogey preflight --people <n>` works them out for any size.

```sh
bogey preflight --people 250          # or --event acme/spring-hack to count the event's people
bogey doctor --remote                 # the wiring checks, if you haven't run them since the last change
```

Preflight exits non-zero on anything that would break at that size and prints the fix next to it; its notes are things that are tight rather than broken. It's on the operator console's Status tab too.

## Where it breaks first

Bogey's web app keeps no state between requests, so the pressure lands on Supabase: Auth's rate limits, Realtime's connection cap, then Postgres.

**Auth rate limits.** Sign-in runs on the Bogey server, so GoTrue sees the server's address on every sign-in, not each attendee's. Its per-IP limits therefore behave as limits for the whole instance (a venue's Wi-Fi, where everyone shares one public address, would do the same). The email limit is per hour for the whole project and applies with the Send Email hook too. The defaults (30 sign-ins per 5 minutes, and 2 to 30 emails an hour) stop an opening rush cold.

| Limit                           | Default         | For 250 people | Supabase CLI (`config.toml`) | Self-hosted (GoTrue env)          |
| ------------------------------- | --------------- | -------------- | ---------------------------- | --------------------------------- |
| Emails per hour (whole project) | 2 (Cloud) to 30 | 500            | `email_sent`                 | `GOTRUE_RATE_LIMIT_EMAIL_SENT`    |
| Sign-ins per 5 minutes          | 30              | 500            | `sign_in_sign_ups`           | `GOTRUE_RATE_LIMIT_OTP`           |
| Code checks per 5 minutes       | 30              | 500            | `token_verifications`        | `GOTRUE_RATE_LIMIT_VERIFY`        |
| Session refreshes per 5 minutes | 150             | 1000           | `token_refresh`              | `GOTRUE_RATE_LIMIT_TOKEN_REFRESH` |

On Supabase Cloud they're under Authentication → Rate Limits; with `SUPABASE_ACCESS_TOKEN` set, preflight reads them. The all-in-one compose and the Supabase overlay set the 250-person values by default (override with `AUTH_RATE_LIMIT_EMAIL_SENT` and friends in the compose `.env`), and so does this repo's `supabase/config.toml`. Check that your SMTP provider's own quota covers the same email volume.

**Realtime connections.** Every open tab is one connection, and people keep a few open. Realtime's default cap is 200 connections at once, under 250 people; past it, new pages get `too_many_connections` and stop updating live. On a self-hosted or CLI stack the limit lives in `_realtime.tenants`: preflight prints the `update`, which has to run as `supabase_admin` (the `postgres` role can read the table but not change it), and then you restart the realtime container; the all-in-one compose seeds new installs with 500. On Supabase Cloud it's the plan: Free allows 200, Pro 500, Pro without the spend cap 10,000.

**Postgres.** Live pages refetch when the rows behind them change. Bogey spreads those refetches over a second and a half, so a scoreboard change doesn't land as 250 queries in the same instant, but the busiest pages (scoreboard, check-in, the judging banner) still cost one query per viewer per change. If preflight shows connections already in heavy use, or the dashboard's CPU sits high during a rehearsal, move up a compute size before the event, not during it.

## Readiness for monitors

`/api/health` only says the web process is up (the image's `HEALTHCHECK`). `/api/ready` says whether people can use it: it checks the database, Auth, Realtime and that mail isn't stuck in the outbox, and answers 200 or 503 with one entry per check:

```json
{
  "ok": false,
  "checks": {
    "database": { "ok": true, "ms": 21 },
    "auth": { "ok": true, "ms": 40 },
    "realtime": { "ok": true, "ms": 12 },
    "email": { "ok": false, "ms": 18, "detail": "mail is waiting to be sent" }
  }
}
```

Point an external uptime monitor at it (from outside your network), once a minute. It probes at most once every 5 seconds however often it's asked.

## The night before

- Run `bogey preflight --event <org/slug>` and fix what it says.
- Take a backup (`bogey backup`); preflight notes one older than a day.
- Rehearse the busiest moment on a staging copy if you can: the opening sign-in, the check-in queue, the submission deadline, or results going up with everyone watching.
- Test the venue's network: captive portals and firewalls that block WebSockets break live pages, and Realtime has no fallback.
- Export what you'd need on paper: the participant list for check-in (Manage → People → Export).

## During the event

- **Freeze.** No `bogey upgrade`, `restart --build` or `bogey.config.ts` edits from an hour before doors open until results are out. A restart takes the single web container down, and a migration isn't promised to work with the app version before it.
- **Watch** `/api/ready`, `bogey queues` (mail and webhooks waiting) and the Supabase dashboard's Auth and Realtime reports.
- **If sign-in stalls**, it's almost always a rate limit: raise it (it takes effect at once on Cloud, after an auth restart when self-hosted) and tell people to wait a minute and try again. `bogey login <email>` prints a sign-in code without email for someone stuck at the desk.
- **If the deadline wobbles**, extend the submission window (Manage → Agenda → Windows) rather than asking people to retry against a struggling database.
