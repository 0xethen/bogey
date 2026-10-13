# 0015: Operator actions are CLI-only; the web app reports and explains

**Status:** accepted (2026-10-03)

## Context

Restarting, stopping, upgrading or rebuilding Bogey needs control of the
host's containers. Giving the web app that control means mounting the Docker
socket or equivalent, which is root on the host. The app is public and
reachable by anyone with a session, so a stolen platform-admin session, an XSS
or a bug in a function would become host compromise. There is also no
local-only admin panel to hold such buttons.

## Decision

- **The web app never controls the host.** No restart, stop or update button,
  and no container runtime access in the web container.
- **Operator actions live in the CLI:** `bogey setup`, `upgrade`, `restart`,
  `stop`, `plugins add`, `backup`, `doctor`. Plain `bogey` with no arguments
  opens an interactive menu over the same commands.
- **Every interactive flow has a flag equivalent** and refuses to prompt
  without a TTY, so scripts and CI behave the same way.
- **The web app reports and explains.** Instance → Overview shows health: the
  Send Email hook (last call), SMTP (with a safe "send test email" button),
  pending migrations, pending plugin migrations, and whether upstream has a
  newer release. Each finding comes with the exact command to run.
- **The UI says what a change needs.** Email edits: nothing, they apply to the
  next message. Plugin install or update: a rebuild and redeploy. GoTrue
  environment changes: a restart of the auth container.
- A separate operator console bound to localhost or a private network may come
  later. It would be its own process, never part of the public app.

## Consequences

- Operators need shell access to do these things, which they already have.
- The app is read-only about the host, so compromising it doesn't compromise
  the machine.
- Every status message has to be accurate about what needs a restart, which
  is why the docs carry a table of changes and what each needs.
