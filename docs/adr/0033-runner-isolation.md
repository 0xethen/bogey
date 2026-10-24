# 0033: The runner is its own unit, with a key that can only judge and no Docker socket

**Status:** accepted (2026-10-23). Refines [0007](0007-judging-pipeline.md) and
[0019](0019-all-in-one-compose.md); keeps [0015](0015-operator-actions-cli-only.md).

## Context

The challenges runner runs code nobody vetted: every team's solution, and the jury's checkers, run
scripts and interactors, which come from problem packages that any jury member can upload. Until
2.4 the all-in-one gave it:

- **the service-role key**, which reads and writes every table of every organization, so a
  compromised runner was a compromised instance;
- **the host's Docker socket**, which is root on the host: anything that can call it can start a
  privileged container with `/` mounted;
- **the default compose network**, shared with Postgres, Auth and the web app.

The sandboxes themselves were already tight (no network, read-only root, no capabilities, user
65534, memory, CPU and process limits), but nothing behind them assumed the sandbox might fail.

## Decision

Three deployable units with their own names and networks, and the runner trusted with as little as
judging needs. The threat model and the operator's side are in
[runner-security.md](../self-hosting/runner-security.md).

- **Units.** The web image (`ghcr.io/0xethen/bogey`) has nothing of the runner in it. The database
  stack (Postgres and the Supabase services) sits on `backend`, which Caddy can't reach; Caddy and
  the app meet on `edge`. The runner image (`ghcr.io/0xethen/bogey-runner`) is three services in
  `compose.runner.yml`, on two internal networks with no way out: `runner-api` (the runner and
  `runner-gateway`) and `runner-docker` (the runner and `docker-proxy`). No runner service shares a
  volume with the web app.
- **Runner keys instead of the service key.** `bogey runner add <name>` makes a random key and
  stores only its SHA-256 in `private.challenges_runner_keys`. The runner sends it in an
  `x-bogey-runner-key` header as the anon role. Six `challenges_runner_*` functions check it and are
  the only things it reaches: claim, heartbeat, record, requeue, release, and the input and answer
  of a test **of a judging it holds right now**. Each wraps the service-role function it replaces,
  under the runner id `key:<name>/<id>`, so a key can't touch another key's leases. Keys are listed,
  revoked and replaced from the CLI; pgTAP (`runner_keys.test.sql`) checks that a key reads nothing
  else and that the old functions stay closed to it.
- **The gateway** (`Caddyfile.runner`) passes on only `POST /rest/v1/rpc/challenges_runner_*` to
  PostgREST, after stripping `Authorization`, `apikey`, `Prefer` and the profile headers, so no
  other role, schema or path can be asked for. It answers everything else with 403.
- **The Docker socket proxy** (`node src/proxy.ts`, the same image) holds the socket. It passes on
  `_ping`, `version`, container create, attach, start, wait, kill and remove, and a list filtered to
  the runner's label. Every action on a container needs that label, and a create body must be the
  shape `dockerArgs` builds: an allowed image, user 65534, network none, read-only root, every
  capability dropped, `no-new-privileges` and the default seccomp and AppArmor profiles, default
  masked paths, memory (no swap), CPU, process and file limits within the host's, logging off, the
  configured runtime, and bind mounts only of real folders (no links) inside the runner's work
  folder. Any other field must be empty. It was checked against Docker 27's CLI by capturing what it
  sends.
- **Every sandboxed run** (compile, test, checker, run script) also gets `--pull never`,
  `--log-driver none`, private IPC and cgroup namespaces, `nproc`, `fsize`, `nofile` and `core`
  limits, a `nosuid,nodev` `/tmp` that is `noexec` except when compiling, `--entrypoint /bin/sh`,
  explicit `--mount` binds with private propagation, and a kill of the whole container at the time
  limit (and of the CLI after a grace period). A judging has one deadline for all its steps. Files
  the runner writes for a sandbox are created with `O_EXCL|O_NOFOLLOW` in folders the sandbox can't
  write; files it reads back (`/io/output`, `score.txt`) must be plain files and are read with a
  size cap, so a planted link or FIFO reads as missing. Each step has its own `mkdtemp` folder under
  a 0700 work folder per runner id, and what a sandbox locks is emptied by a container running as
  the sandbox's user.
- **gVisor or rootless Docker** are selectable, not required: `BOGEY_RUNNER_RUNTIME=runsc` passes
  `--runtime` and the proxy refuses any container without it; `BOGEY_RUNNER_DOCKER_SOCKET` points
  the proxy at a rootless daemon's socket.
- **Base images are pinned by digest**, the Kotlin compiler by checksum, and the runner never pulls.
- **The old path stays for one release line.** The service-role functions keep their grants, the
  runner still starts with `SUPABASE_SERVICE_ROLE_KEY` (with a warning), and `bogey doctor` flags an
  old `compose.runner.yml` and, with `--remote`, judgings taken with the service key in the last
  seven days.

Alternatives considered:

- **A Postgres role in a JWT** (`role: bogey_runner`). Grants would do the restricting, but a JWT
  can't be revoked without rotating the JWT secret, minting one needs that secret (Supabase Cloud's
  new signing keys don't hand it out), and the gateway and PostgREST would need the role configured.
  A hashed key in a table is revocable per runner and works on every Supabase.
- **A path-only socket proxy** (such as `tecnativa/docker-socket-proxy`). It can't read a create
  body, so allowing "create" allows `--privileged -v /:/host`.
- **Talking to the Docker API directly** instead of the CLI. It would drop the attach and CLI
  version quirks, but lose Podman support; the proxy makes the CLI's calls safe instead.

## Consequences

- Stealing the runner's key exposes only queued solutions and the tests of the judgings it claims,
  and lets it write verdicts for those; revoking the key ends it. Taking over the runner container
  gives a Docker that only starts sandboxes as user 65534 with no network, capabilities or host
  mounts.
- A compromised runner host (root on it) still sees what that host runs and what the key can claim.
  Running the runner on its own machine, or gVisor, limits that host to judging.
- The proxy's mount check reads the folder before Docker mounts it; a compromised runner racing to
  swap a folder for a link could win, and would still get only a sandbox user's view. gVisor or
  rootless Docker close that.
- Operators upgrading the all-in-one replace `compose.runner.yml`, add `Caddyfile.runner`, make a key
  and set `BOGEY_RUNNER_KEY`; the work folder must belong to the runner's uid.
- Installs without Docker (the SparkCloud demo runs the all-in-one natively) have no runner;
  solutions wait in the queue, as before.
