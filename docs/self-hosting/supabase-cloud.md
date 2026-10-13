# Supabase Cloud

Run Bogey against a hosted Supabase project and keep only the web app to host. Every dashboard step is
here, in order. Dashboard labels move between releases; where one has changed, look for the setting
by name. After the last step, `bogey doctor --remote` checks what it can.

You need a Supabase account, a domain for Bogey, an SMTP server for sign-in mail, and Bogey's image
(or a checkout) running somewhere that can reach the project (see [Deploying](deploy.md)). If you'd
rather run everything on one server, use the [all-in-one compose](all-in-one.md).

## 1. Create the project

1. New project. Pick the region nearest your participants and a long, random database password; keep
   it, since `bogey db migrate` needs it. The plan decides limits (file size, database size, backups)
   but nothing Bogey needs.
2. **Database → Extensions:** make sure `pg_cron`, `pg_net` and `supabase_vault` are on. Bogey's
   schema creates them if it can; turning them on first avoids a permissions error.

## 2. Copy the keys

**Project Settings → API Keys** (or **Connect**):

| Dashboard       | Bogey's `.env`              | Notes                                              |
| --------------- | --------------------------- | -------------------------------------------------- |
| Project URL     | `SUPABASE_URL`              | `https://<ref>.supabase.co`                        |
| Publishable key | `SUPABASE_PUBLISHABLE_KEY`  | `sb_publishable_...`; the browser gets it          |
| Secret key      | `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...`; server and CLI only, never public |

`bogey setup` asks for them and writes `.env`. The legacy `anon` and `service_role` keys work too.

## 3. Apply the schema

You need a connection string with `psql` available (`bogey` in the image has it). **Connect → Session
pooler** gives one that works over IPv4; the direct `db.<ref>.supabase.co` address is IPv6 only on
most plans.

```sh
bogey db migrate --db-url 'postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
bogey plugins migrate --db-url '...'      # if you installed plugins
```

Percent-encode special characters in the password. To stop passing it every time, put it in `.env`
as `DATABASE_URL`.

## 4. Auth hooks

**Authentication → Hooks:**

1. **Before User Created:** enable, type _Postgres function_, schema `private`, function
   `before_user_created`. This is what enforces each organization's `registration.signup`. Without it,
   sign-ups simply succeed.
2. **Send Email:** enable, type _HTTPS_, address `https://<your Bogey host>/api/auth/send-email`.
   Generate a secret, and put it in Bogey's `.env` as `SEND_EMAIL_HOOK_SECRET` (`v1,whsec_...`). This
   makes sign-in mail carry each organization's name and wording ([Email](email.md)).

## 5. Sign-in settings

**Authentication → Sign In / Providers → Email:**

- Email provider **on**; **Confirm email** on.
- **Email OTP length: 6** (Bogey's sign-in page expects six digits).
- Keep **Allow new users to sign up** on. The hook is the gate; turning sign-up off stops the hook from
  running, and breaks invitations and roster imports.

**Authentication → URL Configuration:** Site URL is your main Bogey address. Add every host Bogey is
served on to **Redirect URLs**, with a glob for subdomains (`https://*.bogey.example.com/**`). A link
to a host not listed lands on the Site URL.

**Authentication → Multi-Factor:** TOTP enroll and verify **on**. Instance admins need an
authenticator app ([Sign-in and auth](auth.md)).

Other providers (Google, GitHub and so on) are in [Sign-in and auth](auth.md#sign-in-providers).

## 6. Email

Bogey sends all sign-in mail itself through the hook, so Supabase's own SMTP settings (and its low
built-in email limit) don't apply. Give Bogey `SMTP_*` in its `.env` ([Email](email.md)).

## 7. Storage

Buckets and their policies are created by the schema. The ceiling on one upload is **Project Settings
→ Storage → Upload file size limit** (50 MB by default). Bogey's own cap, per instance or per
organization, is Instance → Settings → Limits → Largest upload; it can't exceed the project's.

## 8. Start Bogey and create your organization

With `.env` in place and Bogey running:

```sh
bogey org init --org acme --name "Acme Hacks" --owner you@acme.org --host bogey.example.org \
  --app-url https://bogey.example.org
bogey login you@acme.org      # a sign-in code, without email
```

`--app-url` is the address the database calls to send Bogey's own email (registrations, reminders):
Cloud's database reaches your public address, so use your Bogey URL. You can also set it later in
Instance → Settings → Tenancy.

## 9. Check it

```sh
SUPABASE_ACCESS_TOKEN=sbp_... bogey doctor --remote
```

Without the token it checks sign-ups, the keys, the schema, that an organization exists, the app
address and whether mail has gone through the hook. With a token
([account tokens](https://supabase.com/dashboard/account/tokens)) it also reads the dashboard's hooks,
OTP length, Site URL, redirect URLs and authenticator-app settings, and reports any that are wrong.
The token is only read from your shell or `.env`; Bogey never stores it.

## Upgrading

A new Bogey release may include migrations. Run `bogey db migrate --db-url ...` before starting the new
image, as in [Upgrading](upgrading.md). Supabase Cloud upgrades its own services.
