# Security model

**Postgres decides; everything else only renders.** Row-level security (RLS)
and RPCs in `supabase/schemas/` are the authorization boundary. The web
app's server functions validate input so users get good error messages, and
the UI hides what you can't use. Neither of those two layers is a security
check.

## Layers

| Layer                                            | Decides                                                                     | Trusted for                  |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------- |
| RLS policies                                     | which rows each role can see and change                                     | authorization                |
| RPCs (`public.*`, `security definer`)            | writes that span tables or need checks RLS can't express                    | authorization and invariants |
| Triggers                                         | derived columns and cross-row invariants (team size, capacity, author role) | invariants                   |
| Server functions (`packages/db/src/queries`)     | input shape and friendly errors                                             | UX only                      |
| Route `beforeLoad` / permission checks in the UI | what to show                                                                | UX only                      |

## Roles

The database roles:

- **`anon`**: a visitor who isn't signed in. It can read only:
  - public events
  - public pages
  - galleries whose `gallery` window is open
  - published results of public events
  - invite links, and only through `invite_link_view(token)`
  - what a few `security definer` functions hand out on purpose: `event_agenda`, `public_announcements`, `public_profile`
    (public profiles only), `verify_certificate` (by code) and `calendar_feed` (by secret token)
- **`authenticated`**: everything else a signed-in user can do, always
  filtered by RLS.
- **Platform admins** hold a row in `platform_admins`, and by default the
  database only treats them as admins on a session that passed a second factor
  (`aal2`): `private.is_platform_admin()` checks the JWT, so no admin function or
  policy needs its own check.
- **`service_role`**: used by the runner, the CLI and `pg_cron` jobs. The
  web app never uses it for a user's request.

The application roles are org roles and event roles plus the permission
matrix. See [data-model.md → People](data-model.md#people). One function
answers every permission question:
`private.has_permission(event_id, permission)`. The UI's `can()` reads the
same matrix, so the UI and RLS never disagree about who is a judge.

## Tenant isolation

- Every policy on an org-level table checks membership in **that row's**
  `org_id`. Every event-level policy goes through `has_permission`, which
  looks up the event's org.
- No policy asks "admin of _any_ org", and no function falls back to "the
  only org".
- Composite foreign keys make it impossible to attach a row to a parent
  from a different event, and so from a different org.
- Profiles are global. You can read another user's profile only if you
  share an org with them.
- The hosted instance runs a pgTAP test in CI that creates two orgs and
  checks every table from each org's point of view.

## Function hygiene

- **`private` schema:** grant `usage` to `authenticated` and `anon`; revoke
  execute from `public`, then grant execute on each helper to the roles its
  policies run as. `private` isn't in the Data API's exposed schemas, so
  clients can't call these functions directly. Policies can.
- **`security definer` functions** set `search_path = ''`, use
  fully-qualified names, and check `auth.uid()` themselves.
- **`alter default privileges revoke execute on functions from public`**
  runs at the top of the schema, _globally_ rather than per schema.
  Postgres grants EXECUTE on every new function to PUBLIC by default, and a
  per-schema default can only add to that, never remove it. The global
  revoke means a new function is callable by nobody until it is explicitly
  granted.
- **Seeds and maintenance functions** can be executed by `service_role`
  only.

## Write paths that must not be forged

| Risk                                           | Guard                                                                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A participant sets their own verdict           | `challenges_solutions` and `challenges_judgings` have no client insert or update policy. `challenges_submit()` inserts the solution, and only the runner (service role) writes judgings, and only while it holds the lease. |
| Hidden test data leaks                         | `challenges_testcases` has no participant policy. The runner stores output excerpts for samples only, and compile output is shown only to the solution's own team.                                                          |
| Score out of range, or scoring as someone else | A trigger forces `judge_id = auth.uid()` and checks the range. The `judging` window must be open.                                                                                                                           |
| Messages posted with a fake role               | `author_role` is set by a trigger from `has_permission`.                                                                                                                                                                    |
| Writing to another org's audit log             | `log_event()` requires membership in the named event. Core actions come from the RPCs themselves, not from clients.                                                                                                         |
| Reading secrets                                | Secrets are stored in Vault. No policy exposes `vault.secrets`, and the `secrets` table returns names, never values.                                                                                                        |
| Registration answers that break the form       | `submit_registration()` validates the answers against the stored form version.                                                                                                                                              |

## Anti-cheat is a deterrent and a record

Lockdown and the companion extension record signals such as blur, leaving
fullscreen, devtools and tab changes, and they can require a recent
heartbeat before `challenges_submit()` accepts a solution. A browser can't see
a second machine, and anyone determined can defeat any client-side check.
Bogey's UI copy says exactly that. Organizers get specific signals to follow
up on, and nothing in lockdown is presented as proof.

## Secrets outside the database

- Keep `.env` at the repository root. It holds the Supabase URL, the
  publishable key, the service-role key (server and runner only), and the
  runner's credentials.
- **Never prefix a secret with `PUBLIC_`.** Anything with that prefix is
  compiled into the client bundle.
- `bogey.config.ts` holds no secrets. It is the plugin allowlist plus the
  instance security floor.

## Advisor findings that are expected

Supabase's security advisor warns about every `security definer` function
that `authenticated` or `anon` can execute (lints 0028 and 0029). In Bogey
those functions are the API itself: each checks the caller, its permissions
and the relevant window, then does its work atomically.

The list, with a reason for each, is `packages/db/tests/rpc-surface.test.ts`.
The test reads `supabase/schemas` and fails when a new one appears or `anon`
gains one, so adding to the API is always deliberate. Signed out, only
`org_for_host`, `invite_link_view` and `settings_for` are callable. Plugin
functions (`challenges_*`, `lockdown_*`) ship with their plugin
and aren't part of this list. Runner RPCs, seeding and org init are granted
to `service_role` only.

The performance advisor should show no warnings. Each table has one
permissive policy per role and action. Its remaining notices are
informational: every foreign key has a covering index, and a new index reads
as "unused" until the instance has traffic.

## Public API, calendar tokens and webhooks

- The read-only `/api/v1` uses a client with **no session**, so every answer is what `anon` can read through RLS and the
  functions above, the same for everyone. That is also why it can allow cross-origin `GET`s: it never carries anyone's cookies.
- A personal calendar address holds a random token; only its SHA-256 is stored, the page is never cached, and a new token
  replaces the old.
- **Webhooks** can make the database send requests to addresses organizers type, so `webhooks.url` must be `https` on a public
  name (a check constraint refuses `localhost`, internal suffixes and IP addresses). Payloads are the audit entry that caused them,
  which is already free of secrets. Requests are signed with an HMAC of `<timestamp>.<body>` using a per-webhook secret that no
  policy lets anyone read back.
- Event archives hold names, emails and answers. They are made only by organization admins (the people RPC checks) and by the CLI
  with the service key, and importing creates accounts only when `--people` is given.

## Operator console

`apps/console` can run commands on the host, so it is not a web page like the others: it listens on `127.0.0.1` only, refuses
any other `Host`, needs a cookie earned with a one-time token from `bogey console`, checks `Origin` on every POST, and runs a fixed list
of commands by id. It is never in the public image. See [0025](../adr/0025-operator-console.md).
