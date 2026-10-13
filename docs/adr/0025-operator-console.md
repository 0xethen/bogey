# 0025: The operator console is a separate local app

**Status:** accepted (2026-10-10). Follows [0015](0015-operator-actions-cli-only.md), which left room for it.

## Context

0015 kept host control out of the public web app and put operator actions in the CLI. Running `bogey doctor`, checking
migrations, reading a queue or tailing a container's logs from a terminal is fine for people who live in one, but an
operator on a laptop next to the server often wants the same answers on one page. 0015 said such a page "may come later" as
its own process.

## Decision

- **`apps/console` is its own TanStack Start app.** Nothing in `apps/web` imports it, and the public image's entrypoint
  never starts it; it runs from a checkout with `bogey console`.
- **It listens on `127.0.0.1` only** and refuses any request whose `Host` isn't the loopback address and its port (so a web
  page can't reach it by rebinding a name). `bogey console` makes a one-time token, which the console's Vite config adds to
  the `Local:` link Vite prints; opening it sets an
  `HttpOnly`, `SameSite=Strict` cookie holding a hash of the token and redirects the token out of the address bar. Every
  other request needs that cookie, and a request that runs something also needs an `Origin` of the console itself.
- **It runs a fixed list of commands, by id.** The page sends an id (or a log service from a fixed list and a line count)
  and values for the parameters that command declares, never arguments. The server checks each value against its
  pattern, choices or the plugins on disk, refuses any that starts with `-`, and builds the arguments itself; they reach
  the CLI as separate argv entries, with no shell. Read-only ones (doctor, database and plugin migration status, queues)
  run when the page opens; ones that change something wait for a confirmation, and ones with a dry run show it first. Output streams back as it is written; closing the page stops the command.
  (Amended 2026-10-12: commands took no parameters at first.)
- **It uses the CLI.** Commands run `tools/cli/src/bin.ts` as a child process, so the console never has database
  credentials of its own and can't do anything the CLI can't.

## Consequences

- The console is as trusted as the person at the keyboard of that machine, which is the CLI's own trust.
- A new CLI command appears in the console only when someone adds it to the list, on purpose. A test fails until every
  CLI command and subcommand is in the list or in `NOT_IN_CONSOLE` with a reason.
- Container logs need Docker on the same machine; elsewhere that panel says it couldn't start Docker.
- It is not for remote use. To reach it from another machine, use an SSH tunnel to the loopback port.
