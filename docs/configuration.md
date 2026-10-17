# Configuration

Each kind of setting has one home.

| Tier        | Where                                                   | Changed by                | Examples                                       |
| ----------- | ------------------------------------------------------- | ------------------------- | ---------------------------------------------- |
| Environment | `.env` at the repo root, or the container's environment | whoever deploys           | Supabase URL and keys, SMTP, hook secret       |
| Instance    | `bogey.config.ts` at the repo root                      | whoever runs the instance | name, theme, plugins, trusted proxies, headers |
| Settings    | the database, edited in the app                         | admins and organizers     | sign-ups, email templates, deletion, networks  |

## Environment

See `.env.example` for the full list.

| Variable                           | Used by              |                                                                        |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `SUPABASE_URL`                     | server, browser, CLI | Must be reachable from both the server and visitors' browsers.         |
| `SUPABASE_PUBLISHABLE_KEY`         | server, browser      | The publishable (anon) key.                                            |
| `SUPABASE_SERVICE_ROLE_KEY`        | server, CLI          | Secret. Never exposed to the browser.                                  |
| `SMTP_*`, `SEND_EMAIL_HOOK_SECRET` | server               | Sign-in email; see [Email](self-hosting/email.md).                     |
| `BOGEY_TRUST_PROXY`                | server               | `1` is the same as `network.trustProxy: true` in `bogey.config.ts`.    |
| `BOGEY_UPDATE_CHECK`               | server               | `false` stops the release, security advisory and plugin update checks. |
| `BOGEY_PASSKEY_HOST`               | server, browser      | The host passkeys work on; must match GoTrue's WebAuthn RP ID.         |

Nothing is inlined into the browser bundle at build time: the server reads
these when it starts and hands the browser only the URL, publishable key and passkey host.
One build works for every deployment.

## bogey.config.ts

```ts
import { defineConfig } from "@bogey/config/define";

export default defineConfig({
  brand: {
    name: "Acme Hacks",
    shortName: "Acme",
    theme: "default",
    icons: { default: "/brand/logo.svg" },
  },
  appUrl: "https://hacks.acme.org",
  plugins: { disabled: [] },
  events: { uiDeletion: true },
  network: {
    trustProxy: true,
    clientIpHeader: "x-forwarded-for",
    trustedHops: 1,
    trustedProxies: ["172.18.0.0/16"],
  },
  security: {
    verboseErrors: false,
    requireAdminMfa: true,
    deviceSignOut: false,
    maxPasskeys: 5,
    headers: { frameAncestors: ["'self'"], hsts: true },
  },
  email: {
    authTemplates: {
      signIn: { subject: "Your {{org}} sign-in link", body: "Use {{code}} or open {{link}}." },
    },
  },
  repository: "github:acme/bogey",
  updates: { check: true },
});
```

- **`brand`:** the instance's name (the default for the Branding setting),
  the theme (see [Themes](self-hosting/themes.md)) and icons served from
  `apps/web/public`. The icons are also the favicon (`dark` in dark mode);
  without them, Bogey's own shows.
- **`plugins.disabled`:** installed plugins that shouldn't run. Orgs and
  events turn the rest on and off in Settings.
- **`events.uiDeletion`:** whether org admins can delete an event from Manage →
  Danger zone (default `true`). Set `false` to keep events from being deleted
  in the app.
- **`repository`:** this instance's repository as `github:owner/repo`. ⌘K's
  "Report an issue" opens its issues. It defaults to `upstream` (Bogey's own);
  `false` removes the entry.
- **`updates.check`:** whether Bogey asks GitHub for newer releases and for
  security advisories that name the version it runs (Instance → Overview, a
  banner for instance admins, Instance → Plugins, `bogey doctor` and the
  console). They're plain requests to the public Releases and security
  advisories APIs with no instance data, and Bogey has no telemetry. `false`, or
  `BOGEY_UPDATE_CHECK=false`, turns it off; then watch the repository yourself
  (see [Knowing when to upgrade](self-hosting/upgrading.md#knowing-when-to-upgrade)).
- **`security.verboseErrors`:** show real errors on the error page in
  production. They're always shown in development.
- **`security.headers`:** headers the server adds to every response.
  `frameAncestors` lists who may put Bogey in a frame (default `["'self'"]`;
  `[]` allows no one); `hsts: true` sends `Strict-Transport-Security`, so only
  turn it on once the site is served over HTTPS for good;
  `contentSecurityPolicy` is a full policy string, off by default because plugins
  load their own scripts. `X-Content-Type-Options` and `Referrer-Policy` are always sent.
- **`email.authTemplates`:** the wording of the emails that carry a sign-in
  code or link: `signIn`, `signUp`, `invite`, `emailChange` and
  `reauthentication`, with `@<language>` for a translation (`signIn@es`). Each
  must keep `{{code}}` and `{{link}}` (`reauthentication` only `{{code}}`). They're set only here, because an admin
  who could rewrite them could send everyone's sign-in links somewhere else;
  Instance, organization and event email settings cover the rest. Leave a kind
  out for Bogey's wording.
- **`network.trustProxy`:** `true` when a proxy that overwrites X-Forwarded-For
  (like `deploy/compose.yml`'s Caddy) fronts the app, so the app forwards the
  visitor's address to the database.

### Keys only the file sets

Some settings decide who the database trusts, so a stolen admin session must not be
able to change them. Admins see them read-only in the app, labeled "Set in
bogey.config.ts" ([ADR 0029](adr/0029-operator-keys.md)):

| Key                        | Setting                    | What it decides                                                                                                  |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `appUrl`                   | `tenancy.appUrl`           | Where the database calls the app to send queued email ([Email](self-hosting/email.md)), and the link in webhooks |
| `network.clientIpHeader`   | `network.clientIpHeader`   | Which header the database reads a visitor's address from                                                         |
| `network.trustedHops`      | `network.trustedHops`      | How many proxies in front of Supabase append to X-Forwarded-For                                                  |
| `network.trustedProxies`   | `network.trustedProxies`   | The app servers whose forwarded visitor address the database believes                                            |
| `security.requireAdminMfa` | `accounts.requireAdminMfa` | Whether instance admins need an authenticator app (default `true`)                                               |
| `security.deviceSignOut`   | `accounts.deviceSignOut`   | Whether people can sign out one of their other devices from Account (default `false`)                            |
| `security.maxPasskeys`     | `accounts.maxPasskeys`     | How many passkeys one person can add, at most 9 (default `5`; `0` turns passkeys off)                            |

The server writes the ones the file sets to the database on its first request after it
starts. `bogey config apply` writes them without a restart, and `bogey config check` and
`bogey doctor --remote` say when the database differs. A key the file leaves out keeps
whatever the database has, and only the CLI can change it. `bogey mfa off` still lets
locked-out admins back in; if the file says `requireAdminMfa: true`, change it there too,
or the next restart turns it back on.

`deviceSignOut` is off because whoever holds a stolen session could use it to sign the real
person out and keep them out. With it off, Account → "Where you're signed in" still lists
every device and offers "Sign out everywhere", which ends the stolen session too.

### When a change applies

The server reads the file once, when it starts. Edit it and restart the server (`docker compose restart web`);
there is no rebuild. The browser is handed only what it needs: the brand, the repository, the disabled
plugin list, whether events can be deleted and whether errors are verbose. `updates` and `upstream` stay on the server.

| Key                                                                                                                                                | Needs                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `brand.name`, `brand.shortName`, `brand.theme`, `appUrl`, `network`, `repository`, `upstream`, `updates`, `security`, `plugins.disabled`, `events` | a restart (or `bogey config apply` for the keys only the file sets)                         |
| `brand.icons` (the path)                                                                                                                           | a restart; the files themselves are in `apps/web/public`, so changing those needs a rebuild |
| which themes exist, which plugins are installed                                                                                                    | a rebuild                                                                                   |

In a container the file is at `/app/bogey.config.ts`, with a copy baked in as the default. Mount yours over
it read-only (`./bogey.config.ts:/app/bogey.config.ts:ro`, as the compose files do), or point
`BOGEY_CONFIG` at another path. A `bogey.config.json` with the same keys works anywhere a `.ts`
one does, for instances that don't want TypeScript. Node strips the types as it loads the file, so it
needs no build step; use `import type` (or `defineConfig`, which the image provides) for the config's type.

A file that doesn't parse or doesn't match the schema stops the server with a message naming the key.
`bogey doctor` runs the same check and prints every problem.

## Settings

Everything organizers and admins change lives in the `settings` table and
resolves Bogey's defaults → instance → organization → event. Each level can
lock keys so the levels below can't change them: the lock icon beside a setting
on the instance or organization settings pages pins its value there for every
organization or event below. Every settings page shows where a value comes
from, and **Reset** (the arrow icon) removes a level's own value so it inherits
again.

The [settings reference](reference/settings.md) lists every key. It's
generated from `packages/config/src/settings.ts`, which is also where
defaults are declared; `bogey db baseline` copies those defaults into the
database so SQL and TypeScript agree.
