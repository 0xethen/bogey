# Sign-in and auth

Bogey is passwordless: people sign in with a link or a six-digit code sent by
email, or with a provider you turn on. Supabase Auth (GoTrue) does the work; two Bogey pieces sit on top:

- the **Before User Created hook** (`private.before_user_created`), which
  decides whether a new account may be made, from the org's
  `registration.signup` setting (`open`, `invite` or `closed`), and
- the **Send Email hook** (`/api/auth/send-email`), which writes the email in
  the org's name and wording. See [Email](email.md).

## The sign-up gate

`supabase/config.toml` is read **only** by the Supabase CLI. A self-hosted
Docker stack ignores it and configures GoTrue from environment variables, so
set these on the `auth` service:

```env
GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true
GOTRUE_HOOK_BEFORE_USER_CREATED_URI=pg-functions://postgres/private/before_user_created
```

On Supabase Cloud: Authentication → Hooks → Before User Created → Postgres,
schema `private`, function `before_user_created`.

If the hook isn't installed, nothing enforces `registration.signup`: sign-ups
simply succeed, with no error anywhere. Keep sign-up itself **enabled**
(`GOTRUE_DISABLE_SIGNUP` unset or `false`). Disabling it looks safer and
isn't: the hook never runs, and invitations and roster imports break.

`bogey doctor` checks both `config.toml` and, when it sees `GOTRUE_*`
variables, the self-hosted wiring. To test the gate with an org's sign-ups
`closed`:

```sh
curl -s -X POST "$SUPABASE_URL/auth/v1/otp" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"probe@example.test","create_user":true}'
```

A working gate rejects this.

## Links and codes

Every sign-in email carries both. The link points at `/auth/confirm` with a
token hash, which the server verifies, so it works on any device: open it on a
phone and you're signed in on the phone. The code is for typing into the
browser that asked, from the "Email on a different device?" box. Using one
invalidates the other. Set `GOTRUE_MAILER_OTP_LENGTH=6`.

## Sign-in providers

Besides an emailed code or link, people can sign in with Google, GitHub, Microsoft, GitLab, Discord,
Keycloak, or their company's single sign-on (SAML). Each provider has three switches, and all must be on
for its button to show:

1. **Set it up in Supabase Auth** with the provider's client ID and secret (below). Until then Auth
   doesn't offer it.
2. **Allow it on the instance:** Instance → Settings → Sign-in methods.
3. **Optionally narrow it for one organization:** Organization → Settings → Sign-in methods. An
   organization can turn off ones the instance allows, never add one. The setting is
   `signin.providers`.

People can also link a provider to an existing account (Account → Linked sign-ins) and unlink it.
Linking needs `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`, which the all-in-one compose and Bogey's
overlay set, and **Allow manual linking** under Authentication → Sign In / Providers on Supabase Cloud.
Someone who already has an account with the same email address signs in to it.

**The sign-up hook still decides who may make an account.** A provider's sign-up can't tell the hook
which hostname it came from, so a new account made with one is filed under the instance's default
organization and follows that organization's `registration.signup` (`open`, `invite` or `closed`). That
makes providers a good fit for an instance with one organization; on a many-organization instance, they
mostly serve people who already have accounts. If the default organization is `closed`, a provider can't
create anyone.

Every provider's redirect (callback) address is the same:

```
<API_EXTERNAL_URL>/callback        e.g. https://bogey.example.org/auth/v1/callback
```

On the all-in-one compose and Bogey's overlay, a provider is a few lines in `.env`. On Supabase Cloud
it's Authentication → Sign In / Providers → the provider; paste the same client ID and secret there.
Restart the `auth` service after changing its environment (`docker compose up -d auth`).

| Provider  | In the provider's console                                                                                                                                          | `.env` (all-in-one)                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google    | Google Cloud → APIs & Services → Credentials → OAuth client ID, type _Web application_; authorized redirect URI is the callback                                    | `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET`                                                                                                   |
| GitHub    | Settings → Developer settings → OAuth Apps → New; _Authorization callback URL_ is the callback                                                                     | `GITHUB_ENABLED=true`, `GITHUB_CLIENT_ID`, `GITHUB_SECRET`                                                                                                   |
| Microsoft | Microsoft Entra ID → App registrations → New; redirect URI (type _Web_) is the callback; a client secret; add the `email` optional claim under Token configuration | `AZURE_ENABLED=true`, `AZURE_CLIENT_ID`, `AZURE_SECRET`, `AZURE_URL=https://login.microsoftonline.com/<tenant-id>` (leave `AZURE_URL` empty for any account) |
| GitLab    | User settings → Applications; scopes `read_user` and `openid`; redirect URI is the callback                                                                        | `GITLAB_ENABLED=true`, `GITLAB_CLIENT_ID`, `GITLAB_SECRET`, and `GITLAB_URL` for a self-managed GitLab                                                       |
| Discord   | Developer Portal → New Application → OAuth2 → Redirects; the sign-in asks for `identify` and `email`                                                               | `DISCORD_ENABLED=true`, `DISCORD_CLIENT_ID`, `DISCORD_SECRET`                                                                                                |
| Keycloak  | Realm → Clients → Create (OpenID Connect, client authentication on); valid redirect URI is the callback; secret under Credentials                                  | `KEYCLOAK_ENABLED=true`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_SECRET`, `KEYCLOAK_URL=https://keycloak.example.org/realms/<realm>`                                 |

Check each with `curl "$SUPABASE_URL/auth/v1/settings"`: the provider is `true` under `external`. The
Settings page also says "Not turned on in Supabase Auth yet" next to one that isn't. If you run
Supabase's own stack with Bogey's overlay instead, the same variables go on the `auth` service as
`GOTRUE_EXTERNAL_<PROVIDER>_ENABLED`, `_CLIENT_ID`, `_SECRET` and `_REDIRECT_URI` (and `_URL`).

### Single sign-on (SAML)

For an organization whose people sign in with their company account (Okta, Entra ID, Google Workspace and
others). The person types their work email, and Auth finds the identity provider from its domain.
It isn't a client ID and secret: SAML needs a signing key, and each identity provider is registered
through Auth's admin API.

1. **Enable SAML.** On the all-in-one compose, `bogey setup --all-in-one --saml` makes the key and sets
   `SAML_ENABLED=true` and `SAML_PRIVATE_KEY`; restart `auth`. By hand, `SAML_PRIVATE_KEY` is a
   Base64 PKCS#1 DER RSA key, as in
   [Supabase's guide](https://supabase.com/docs/guides/self-hosting/self-hosted-saml-sso). On Supabase
   Cloud, SAML is on for Pro plans and up.
2. **Give the identity provider Auth's details:** entity ID `<API_EXTERNAL_URL>/sso/saml/metadata`,
   reply (ACS) address `<API_EXTERNAL_URL>/sso/saml/acs`, name ID `persistent` or email.
3. **Register it**, with the domains it covers:

   ```sh
   curl -X POST "$SUPABASE_URL/auth/v1/admin/sso/providers" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
     -d '{"type":"saml","metadata_url":"https://idp.example.org/metadata","domains":["example.org"]}'
   ```

   On Supabase Cloud, `supabase sso add --type saml --project-ref <ref> --metadata-url ... --domains example.org`.

4. **Allow "Single sign-on"** in Settings. The sign-in page then has **Single sign-on...**.

## Redirect URLs

GoTrue only honors a `redirect_to` that matches its allow-list exactly, and on
a miss it silently sends people to `SITE_URL` instead. Bogey finishes sign-in
wherever the code lands, so nobody is locked out, but add every host anyway
(globs are allowed, like `https://*.bogey.example.com/**`):

- Supabase CLI: `additional_redirect_urls` in `config.toml`
- Self-hosted: `GOTRUE_URI_ALLOW_LIST` (or `ADDITIONAL_REDIRECT_URLS` in
  Supabase's `.env`)
- Cloud: Authentication → URL Configuration

## Instance admins and a second factor

Signing in is email only, so whoever reads an admin's inbox could otherwise run the
whole instance: every org, its settings, who may be an admin. So instance admins
need an authenticator app (TOTP) too. By default, the database doesn't treat an
admin as one until the session has passed a six-digit code (`aal2`), and it checks
that in `private.is_platform_admin()`, so every admin function and policy is
covered, not just the Instance pages.

An admin who signs in without it sees "Verify to open Instance" in the account menu,
and the Instance pages send them to Account to set up an app (once) or enter a code
(each sign-in). It needs TOTP enabled in GoTrue: on by default when self-hosting
(`GOTRUE_MFA_TOTP_ENROLL_ENABLED` and `GOTRUE_MFA_TOTP_VERIFY_ENABLED`), and on in
Bogey's `supabase/config.toml`. Supabase Cloud has it on.

Turn the requirement off in Instance → Settings → Accounts, or, if no admin can
get in to do that, from the CLI:

```sh
bogey mfa status
bogey mfa off   # lets admins in with email alone; turn it back on afterwards
bogey mfa on
```

The first admin comes from `bogey org init`, which uses the service role and
needs no second factor; they set one up from Account the first time they open
Instance. The CLI and the service role aren't affected by the setting.

## When no email arrives

A `POST /auth/v1/otp` returning `{}` means GoTrue accepted the request, not
that mail was sent. Check, in order:

1. `curl "$SUPABASE_URL/auth/v1/settings"`: if `mailer_autoconfirm` is
   `true`, GoTrue confirms users without sending anything.
2. The Send Email hook: GoTrue's logs show the hook's response, and the app
   logs `[bogey] send-email hook:` with the reason.
3. SMTP settings (`SMTP_*` in Bogey's `.env`, or `GOTRUE_SMTP_*` without the
   hook).

To sign someone in without mail, print a code with the CLI:

```sh
bogey login someone@example.com
```

It refuses an address with no account, since GoTrue would otherwise create
one; pass `--create` when you mean to.
