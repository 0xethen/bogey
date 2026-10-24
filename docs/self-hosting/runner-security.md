# Runner security

The challenges runner runs code nobody has checked: every team's solution, and the jury's checkers
and run scripts. This page is what keeps that code in its box, what each part may do, and how to set
it up. The decision and the alternatives are in [ADR 0033](../adr/0033-runner-isolation.md); how
judging works is in the [runner's README](../../tools/runner/README.md).

## Three units

| Unit           | What                                                                                   | Where it runs                                 |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Web            | `ghcr.io/0xethen/bogey`: the app and the CLI. Nothing of the runner is in it           | `web` (and `migrate`) in `compose.yml`        |
| Database stack | Postgres, Auth, REST, Realtime, Storage, and the gateway Kong                          | `compose.yml`, on the `backend` network       |
| Runner         | `ghcr.io/0xethen/bogey-runner`: `runner`, `docker-proxy`, and `runner-gateway` (Caddy) | `compose.runner.yml`, or a machine of its own |

The networks in the all-in-one:

| Network         | Who is on it                                                             | Way out to the internet       |
| --------------- | ------------------------------------------------------------------------ | ----------------------------- |
| `edge`          | Caddy, Kong, web                                                         | yes                           |
| `backend`       | Postgres and the Supabase services, Kong, web, migrate, `runner-gateway` | yes (mail, sign-in providers) |
| `runner-api`    | `runner`, `runner-gateway`                                               | no                            |
| `runner-docker` | `runner`, `docker-proxy`                                                 | no                            |

So the runner reaches two things: the gateway, which passes on only its six database functions, and
the proxy, which passes on only the container calls it makes. It can't reach Postgres, the REST API's
other paths, Auth, Storage, the web app or the internet, and nothing else can reach the proxy. Caddy
can't reach Postgres or any service behind Kong. The runner shares no volume with the web app; its
only folder is its work folder.

## Threat model

What is worth protecting: hidden tests and answers, other teams' solutions, every organization's
data, the service-role and JWT secrets, and the host.

**A hostile solution.** It runs in a container with no network, a read-only root, every capability
dropped, `no-new-privileges`, Docker's default seccomp and AppArmor profiles, as user 65534, with
memory (no swap), CPU, process (`--pids-limit` and `nproc`), file size (`fsize`), open file and
core-dump limits, a small `nosuid,nodev,noexec` `/tmp`, and its program mounted read-only. It is
killed, container and all, at its time limit. It sees its own input and nothing else; its output is
capped, and a NUL byte or a flood can't stop the verdict being stored. What it can do: use its share
of CPU until the limit, and try kernel exploits through the syscalls seccomp allows. gVisor (below)
takes the host kernel out of reach.

**A hostile jury member.** Anyone who can edit a problem can upload a checker, a run script or a
whole package. Those run in the same kind of sandbox as solutions (a checker gets the test's input,
answer and the team's output read-only, and only its feedback folder writable). Every file the runner
writes for a sandbox is created fresh in a folder the sandbox can't write, never through a link, and
every file it reads back (`/io/output`, `score.txt`) must be a plain file, read with a cap, so a
planted link, FIFO or huge file reads as missing. Each step gets its own `mkdtemp` folder, and folders
a sandbox locked are emptied by a container running as the sandbox's user. A jury member can still
make their own problem judge wrongly; that is their problem's business, not a way out.

**A stolen runner key.** It can claim queued judgings (and so read those solutions), read the tests
of the judgings it holds, and record verdicts for them. It can't read any table, list or add keys,
call the service-role functions, or touch another key's judgings. `bogey runner revoke <name>` ends
it at its next call. pgTAP (`packages/plugins/bundled/challenges/tests/runner_keys.test.sql`) checks
all of that.

**A taken-over runner container.** It has the runner key (above) and the proxy. The proxy creates
only containers that pass the same checks as a hostile solution: an allowed image, user 65534,
network none, no capabilities, default security profiles, limits within the host's, and bind mounts
only of real folders inside the runner's work folder. It refuses exec, image pulls, builds,
volumes, networks and every other container. Every refusal is logged.

**A compromised runner host** (root on it). It has the key and Docker. That is why the runner can
live on its own machine with nothing else of the instance: then a lost host costs what the key can
reach, and you revoke the key.

**Left open, on purpose or for now:**

- The proxy checks a mount's folder, then Docker mounts it; a taken-over runner racing to swap the
  folder for a link could mount something else, still only as user 65534 with no network. gVisor or
  rootless Docker close it.
- A solution's time is wall-clock less the container's start-up, so a noisy neighbor on the same
  cores skews timings (see the README's capacity notes).
- A jury member can always leak their own problem's tests; the runner doesn't decide who is on a jury.

## Set up (all-in-one)

1. **The work folder**, owned by the runner's uid (1000 unless you set `BOGEY_RUNNER_UID`), on the
   host, at the same path the runner sees it:

   ```sh
   sudo install -d -o 1000 -g 1000 -m 700 /var/lib/bogey-runner
   ```

2. **The language images**, on the same host (the runner never pulls):
   `tools/runner/images/build.sh pull`, or `build.sh` to build them.

3. **A key** for the runner, then put it in `.env`:

   ```sh
   docker compose exec web bogey runner add runner     # prints BOGEY_RUNNER_KEY=... once
   ```

4. **The socket's group** in `.env`: `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`.

5. **Start it and check it:**

   ```sh
   docker compose -f compose.yml -f compose.runner.yml up -d
   docker compose -f compose.yml -f compose.runner.yml run --rm runner node src/main.ts --self-test
   docker compose exec web bogey runner keys          # shows when the key was last used
   ```

## A runner on its own machine

Recommended for a contest that matters. On that machine you need Docker, the language images, and
`deploy/runner/` (a compose file with `runner` and `docker-proxy`, and an `.env.example`). Set
`SUPABASE_URL` to the instance's public address, `SUPABASE_ANON_KEY` to its anon (publishable) key,
which only gets requests past the gateway, and `BOGEY_RUNNER_KEY` to a key made for this machine
(`bogey runner add judge-1`). Give every machine its own key and `BOGEY_RUNNER_ID`.

## gVisor

[gVisor](https://gvisor.dev) runs each sandbox on its own user-space kernel, so a kernel exploit in
a solution hits gVisor, not the host. Install `runsc` and register it with Docker:

```sh
# https://gvisor.dev/docs/user_guide/install/
sudo runsc install && sudo systemctl restart docker
docker run --rm --runtime runsc bogey-runner-python:3.13 python3 -c 'print(1)'
```

Then set `BOGEY_RUNNER_RUNTIME=runsc` in `.env`. The runner passes `--runtime runsc` and the proxy
refuses any container without it. Run the self-test afterwards: gVisor makes system calls slower, so
start-up and I/O-heavy solutions take longer; give time limits some room.

## Rootless Docker

A [rootless Docker](https://docs.docker.com/engine/security/rootless/) daemon runs as an ordinary
user, so even a container escape lands as that user. Point the proxy at its socket with
`BOGEY_RUNNER_DOCKER_SOCKET=/run/user/<uid>/docker.sock` and set `DOCKER_GID` to that user's group.
Memory, CPU and process limits need cgroup v2 with delegation (`systemctl --user` and the
`Delegate=` setting from Docker's rootless guide); without it, limits are ignored and the self-test's
memory and endless-output checks fail. Run the self-test.

## What the proxy lets through

| Call                                                                               | When                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET`/`HEAD /_ping`, `GET /version`                                                | always                                                             |
| `POST /containers/create?name=bogey-...`                                           | the body is a sandbox (above); anything else is listed and refused |
| `POST /containers/{id}/attach`, `start`, `wait`, `kill`; `DELETE /containers/{id}` | the container carries the runner's label                           |
| `GET /containers/json`                                                             | filtered on the runner's label                                     |

Everything else is a 403. `BOGEY_DOCKER_PROXY_LOG=all` logs every call it passes, not only refusals.

## Images

The runner's own image and every language image start from a base pinned by digest, and the Kotlin
compiler is checked against its SHA-256. To pin the language images themselves, pull them by
digest, set each language's `image` in `challenges_languages` to `name@sha256:...`, and list those
names in `BOGEY_RUNNER_IMAGES` (the default allows `bogey-runner-*` and
`ghcr.io/0xethen/bogey-runner-*`). The runner refuses any other image, and the proxy too.

## Coming from 2.3 or earlier

The old `compose.runner.yml` gave the runner `SUPABASE_SERVICE_ROLE_KEY` and the Docker socket.

1. `bogey plugins migrate` (the `migrate` service does it on start) adds runner keys.
2. Replace `compose.runner.yml` with this release's, and add `Caddyfile.runner` next to it.
3. Make the work folder belong to the runner's uid (step 1 above), and make a key (step 3).
4. `docker compose -f compose.yml -f compose.runner.yml up -d --remove-orphans`.

Until then the runner keeps working with the service key and prints a warning. `bogey doctor` flags
an old `compose.runner.yml` next to it, and `bogey doctor --remote` (and `bogey runner keys`) flag a
runner that judged with the service key in the last seven days. A runner on its own machine needs
the same: a key, `BOGEY_RUNNER_KEY`, `SUPABASE_ANON_KEY`, and no `SUPABASE_SERVICE_ROLE_KEY`.

## Without Docker

An instance run without Docker (such as the SparkCloud demo, which runs the all-in-one's services
natively in an unprivileged container) has no runner: solutions queue and wait, and the browser's
preview still runs Python and JavaScript samples. Run a runner on another machine
([above](#a-runner-on-its-own-machine)) to judge them.
