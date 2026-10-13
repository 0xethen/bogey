# 0012: Plugins are installed from tagged releases, pinned, and trusted code

**Status:** accepted (2026-10-03). Extends [0009](0009-plugins-ship-separately.md).

## Context

[0009](0009-plugins-ship-separately.md) says Bogey ships no plugins and that
putting one on disk is the operator's act of trust. It doesn't say how a
plugin gets there, how that stays reproducible, or what the operator is told
first. The first-party plugins live in `0xethen/bogeyx`, a repository
with one folder per plugin; anyone can publish their own.

## Decision

- **Install from a tag.** `bogey plugins add github:<owner>/<repo>/<plugin>@<version>`
  downloads the tagged tarball and unpacks the plugin's folder into
  `packages/plugins/installed/<key>/`. The manifest's `source` (`repository` and
  `directory`) names where it came from. In a repository with several
  plugins, tags are `<plugin>-v<version>`.
- **Pin it.** A committed lockfile (`bogey.plugins.lock`) records each plugin's
  source, version and a hash of its files. `bogey plugins install` reproduces
  exactly that, and `bogey doctor` fails when a folder's hash differs.
- **Check the attestation.** The plugins repository's workflow attests each archive and
  publishes it through a draft (immutable releases). `bogey plugins add` asks `gh` whether
  the download is attested and shows the answer; `--require-attestation` refuses without.
- **Show before running.** Adding a plugin prints its manifest summary and its
  SQL, and asks for confirmation before anything is applied.
- **Declared permissions, advisory.** A manifest lists what it needs: tables it
  creates or reads, network hosts it calls, settings it reads. The list is
  shown at install time and on Instance → Plugins. Nothing enforces it.
  The docs say plainly that a plugin is trusted code, like an npm package: it
  runs in the app's process with the app's privileges.
- **Installing needs a rebuild.** Plugins are bundled at build time. The UI
  says so on Instance → Plugins, with the command to run.
- **No registry in 2.0.** `bogeyx` may carry a JSON index of known
  plugins for `bogey plugins search`; that is a convenience, not a trust root.
- **Update checks** read GitHub Releases (see [0011](0011-releases-and-upgrades.md))
  and never install anything.

### What plugins can add to the app's chrome

- **Account menu:** the `accountMenu` slot stays for custom items. A simple
  link is declared instead, `accountLinks: [{ label, path | href }]`, so Bogey
  can list it without running plugin code.
- **⌘K:** `commands` entries can open one of the plugin's pages (as today),
  open an external `https:` link (`href`), or run a client-side handler
  registered in the runtime (`action`). Each entry has a label and keywords,
  and is listed in the manifest.
- **Instance repository link:** `bogey.config.ts` gets `repository`
  (`github:owner/repo`), and Bogey offers a built-in ⌘K "Report an issue" entry
  that opens `<repository>/issues`. It defaults to `upstream`, and `false`
  hides it, so a fork can point reports at itself.
- **Localization is a plugin.** Core ships English. The `i18n` plugin
  supplies catalogs and a per-person locale. Core's part is a seam: strings go
  through one function that a plugin can replace, and email templates are
  keyed by kind and an optional locale ([0013](0013-email-templates.md)).

## Consequences

- A plugin's behavior at a given version can be reviewed once and reproduced.
- Without enforcement, the permissions list is only as honest as its author;
  the confirmation step and the lockfile hash are the real controls.
- Plugins can't reach into the chrome through free-form code; each addition
  is a declared, listable entry.
