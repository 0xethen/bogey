# CLI: the interactive `bogey`

Decided in [ADR 0015](../adr/0015-operator-actions-cli-only.md); every command is in
[reference/cli.md](../reference/cli.md).

## Why

Operator actions (setup, upgrading, restarting, plugins, backups) are CLI-only, so the CLI
is the operator's whole interface. Someone who has just cloned Bogey shouldn't need to know
the command names.

## What it does

- **`bogey` with no arguments**, at a terminal, opens a numbered menu: check the instance,
  list and add organizations, list, check and install plugins, upgrade, back up, set up
  `.env`, restart, rebuild and restart, stop. Each entry runs the same command with the
  arguments you answer; nothing in the menu does what a command doesn't. Anywhere else (a
  script, CI, a pipe) it prints the usage.
- **Every command works without prompts**, through flags and the environment. `plugins add`
  won't install without a person unless you pass `--yes`.
- **Prompt code is separate from command code** (`src/menu.ts`), so the menu is tested with
  scripted answers and the commands without a terminal.

## Commands added for this

| Command                     | Does                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `bogey restart [--build]`   | Restarts the app, or rebuilds the image first                                 |
| `bogey stop [--down]`       | Stops the app's containers                                                    |
| `bogey plugins add <spec>`  | Installs a release, shows its SQL, asks, and locks it in `bogey.plugins.lock` |
| `bogey plugins install`     | Restores the lock exactly                                                     |
| `bogey upgrade --to <tag>`  | Merges a release tag; the default is the latest stable release                |
| `bogey email templates`     | Regenerates the fallback templates GoTrue uses without the hook               |
| `bogey mfa on\|off\|status` | The authenticator-app requirement for instance admins                         |

Sending a test email is a button in Instance → Settings → Email, not a command, since
it needs the app's SMTP settings.

## Not built yet

- A compose file that bundles Supabase's services with Bogey. Today Supabase runs
  separately (Cloud, or its own self-hosted compose); `deploy/supabase.bogey.yml` is the
  overlay that wires its auth service to Bogey.
