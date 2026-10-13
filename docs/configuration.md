# Configuration

Each kind of setting has one home.

| Tier        | Where                                                   | Changed by                | Examples                                      |
| ----------- | ------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| Environment | `.env` at the repo root, or the container's environment | whoever deploys           | Supabase URL and keys, SMTP, hook secret      |
| Instance    | `bogey.config.ts` at the repo root                      | whoever runs the instance | name, logo, theme, disabled plugins           |
| Settings    | the database, edited in the app                         | admins and organizers     | sign-ups, email templates, deletion, networks |

## Environment

See `.env.example` for the full list.

| Variable                           | Used by              |                                                                  |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------- |
| `SUPABASE_URL`                     | server, browser, CLI | Must be reachable from both the server and visitors' browsers.   |
| `SUPABASE_PUBLISHABLE_KEY`         | server, browser      | The publishable (anon) key.                                      |
| `SUPABASE_SERVICE_ROLE_KEY`        | server, CLI          | Secret. Never exposed to the browser.                            |
| `SMTP_*`, `SEND_EMAIL_HOOK_SECRET` | server               | Sign-in email; see [Email](self-hosting/email.md).               |
| `BOGEY_TRUST_PROXY`                | server               | `1` when a proxy that overwrites X-Forwarded-For fronts the app. |
| `BOGEY_UPDATE_CHECK`               | server               | `false` stops the release and plugin update checks.              |

Nothing is inlined into the browser bundle at build time: the server reads
these when it starts and hands the browser only the URL and publishable key.
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
  plugins: { disabled: [] },
  security: { verboseErrors: false },
  repository: "github:acme/bogey",
  updates: { check: true },
});
```

- **`brand`:** the instance's name (the default for the Branding setting),
  the theme (see [Themes](self-hosting/themes.md)) and icons served from
  `apps/web/public`.
- **`plugins.disabled`:** installed plugins that shouldn't run. Orgs and
  events turn the rest on and off in Settings.
- **`repository`:** this instance's repository as `github:owner/repo`. ⌘K's
  "Report an issue" opens its issues. It defaults to `upstream` (Bogey's own);
  `false` removes the entry.
- **`updates.check`:** whether Instance → Overview and Instance → Plugins ask
  GitHub for newer releases. It's one plain request to the public Releases API
  with no instance data, and Bogey has no telemetry. `false`, or
  `BOGEY_UPDATE_CHECK=false`, turns it off.
- **`security.verboseErrors`:** show real errors on the error page in
  production. They're always shown in development.

### When a change applies

The server reads the file once, when it starts. Edit it and restart the server (`docker compose restart web`);
there is no rebuild. The browser is handed only what it needs: the brand, the repository, the disabled
plugin list and whether errors are verbose. `updates` and `upstream` stay on the server.

| Key                                                                                                                 | Needs                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `brand.name`, `brand.shortName`, `brand.theme`, `repository`, `upstream`, `updates`, `security`, `plugins.disabled` | a restart                                                                                   |
| `brand.icons` (the path)                                                                                            | a restart; the files themselves are in `apps/web/public`, so changing those needs a rebuild |
| which themes exist, which plugins are installed                                                                     | a rebuild                                                                                   |

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
