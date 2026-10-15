# Operator console

A page on the machine Bogey runs on, for the checks and chores you would otherwise type: whether the install is healthy,
which migrations are applied, what mail and webhooks are waiting, the last lines of a container's log, and the operator
commands of the CLI (database, plugins, orgs, events, restart and upgrade).

```sh
vpr bogey console          # or: bogey console --port 4000
```

Vite's `Local:` line is the link to open, with a one-time token on it: `http://127.0.0.1:3737/?token=...`. Open it in a
browser **on that machine**. The console listens on the loopback address only; to use it from another computer, tunnel the
port over SSH (`ssh -L 3737:127.0.0.1:3737 you@server`) and open the same link. Ctrl+C where you started it closes it, and a
new run makes a new token.

It needs a checkout of Bogey (it is `apps/console`), not just the image. It runs the CLI from a fixed list of commands,
grouped in tabs:

| Tab             | Commands                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status          | `doctor` (and `--remote`), `db status`, `plugins status`, `queues` (these four run when the page opens), `plugins list`, `plugins outdated`, `mfa status`, `config check`, `org list` |
| Database        | `db migrate`, `db repair` (preview with `--dry-run`, then apply), `backup`                                                                                                            |
| Plugins         | `plugins migrate`, `info`, `enable`, `disable`, `search`, `add` (preview, then install), `install`, `remove` (preview, then uninstall), `library`, `sql`                              |
| Orgs & accounts | `org init`, `org create`, `org domain add`/`remove`, `login`, `mfa on`/`off`, `seed demo`                                                                                             |
| Events          | `event export`, `event import`                                                                                                                                                        |
| App & host      | `config apply`, `restart` (and `--build`), `stop`, `upgrade` (preview with `--dry-run`, then run), container logs                                                                     |

The commands sit in a side panel next to a terminal-style screen; drag the divider between them to resize (stretched wide, the panel lays its commands out in two columns). Each command is a row showing the exact `bogey ...` line it will run; click it for its options, or type in the search box to find one across tabs. Running one opens a tab on the screen with its output. Anything that changes something asks first, and the CLI never prompts (the console runs it with `BOGEY_NO_INPUT=1`; a command that needs an answer says which flag gives it). Container logs come from
`deploy/compose.yml` through Docker. Next to the version in the header, the console shows a newer release (linking to its
notes) or, in red, a security advisory that names the version you run (see
[Knowing when to upgrade](upgrading.md#knowing-when-to-upgrade)). The commands that author Bogey itself (`docs`, `themes`, `types`, `release`, `db
baseline`, ...) and `reset` stay in the terminal. See [0025](../adr/0025-operator-console.md) for why it is separate from the web app.

## Terminal (off by default)

Set `CONSOLE_DANGEROUSLY_ENABLE_TERMINAL=1` in the root `.env` (or the environment) and restart the console to get a
**Terminal** tab: type any `bogey` command (with or without the `bogey`), or just `bogey` for its menu, and answer its
prompts as you would in a real terminal; Ctrl+C stops it. Unlike the rows, this runs _any_ CLI command with whatever
arguments you give it, including `reset`, so anyone who can open the console can do anything the CLI can. It needs
`script(1)` (macOS and Linux have it) to give the CLI a terminal; the size is set when a command starts.
