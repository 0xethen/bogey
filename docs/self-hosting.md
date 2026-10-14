# Self-hosting

A Bogey instance is the published image (or one built from a small
instance repository, made from
[bogey-instance](https://github.com/0xethen/bogey-instance)) plus a
Supabase project. Pick one path:

- **[All in one](self-hosting/all-in-one.md):** one compose file with Bogey,
  the Supabase services it needs and Caddy. The shortest way from a bare
  server to a running instance.
- **[Supabase Cloud](self-hosting/supabase-cloud.md):** a hosted Supabase
  project, every dashboard step in order, and the web app deployed with the
  [plain compose](self-hosting/deploy.md).
- **[Your own Supabase](self-hosting/supabase.md):** Supabase's self-hosted
  stack plus Bogey's overlay, deployed with the
  [plain compose](self-hosting/deploy.md).

Then, for every path:

1. **[Email](self-hosting/email.md):** SMTP and the Send Email hook, so
   sign-in mail carries each organization's name and wording.
2. **[Sign-in and auth](self-hosting/auth.md):** how passwordless sign-in
   works, sign-in providers, and what to check when it doesn't.
3. **[Configuration](configuration.md):** `.env`, `bogey.config.ts`, and the
   settings admins change in the app.
4. **[Deploying](self-hosting/deploy.md):** the image behind Caddy, one
   hostname or many organizations, the CLI in the image, `bogey org` and
   backups.
5. **[Upgrading](self-hosting/upgrading.md):** a new image, or merging
   upstream into a fork, and applying schema changes.

And, optionally:

- **[Network limits](self-hosting/network.md):** limit an event to a venue's
  Wi-Fi, and tell the database where visitors' IPs come from.
- **[Themes](self-hosting/themes.md):** your own colors, fonts and radius.
- **[Plugins](plugins.md):** install and write plugins.

After setting up, run `bogey doctor`. It checks the sign-up hook wiring,
`.env` safety and plugin configuration in one pass.

## Supabase advisor warnings you should expect

The security advisor flags every `SECURITY DEFINER` function in `public`.
Those are Bogey's API and each checks its caller; the list, with a reason for
each, is `packages/db/tests/rpc-surface.test.ts`, and the
[security model](architecture/security-model.md) explains the rest. The
performance advisor should show no warnings.

**Do NOT ignore** a new warning after a schema change, especially
`rls_disabled_in_public` or a table without policies. A plugin that creates a
table without policies has created a table anyone can read.
