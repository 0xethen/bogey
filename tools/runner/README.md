# The challenges runner

Judges solutions to the [challenges extension](../../packages/plugins/bundled/challenges/manifest.ts), which ships with Bogey. A team submits code; the plugin queues a
_judging_; this program claims it, compiles the code and runs it against the problem's tests inside
Docker containers, and records a verdict. Without a runner, solutions queue and wait.

It holds the project's **service key** (it reads hidden tests and writes verdicts), so run it on a machine
you control, not in a browser or on a participant's laptop.

## What you need

- A **Linux** host with **Docker** and **cgroup v2** (any current distribution). Docker Desktop on a Mac works for trying it out;
  its timings are noisy, so don't run a contest on it.
- The language images, built once on that host (below).
- The project's address and service key.

**Capacity.** A judging takes a second or two (more for Java, Kotlin, Rust and Go, which compile).
One runner with `BOGEY_RUNNER_CONCURRENCY=2` on 2 cores comfortably serves about **20 teams**; double
the cores and the setting, or run another runner, for each 20 more. Judgings are claimed with
`FOR UPDATE SKIP LOCKED`, so any number of runners can share one queue, and a busy organization can't starve the rest.

## Set up

```sh
cd tools/runner
images/build.sh              # builds bogey-runner-python:3.13, -node:22, -gcc:14, -java:21, -kotlin:2.1, -rust:1.85, -go:1.24
# or: images/build.sh pull   # the published ones, tagged with the same names
export SUPABASE_URL=https://bogey.example.org
export SUPABASE_SERVICE_ROLE_KEY=...
node src/main.ts --self-test # judges known programs in every language; fix anything marked FAIL
node src/main.ts             # start judging (Node 22.18 or newer)
```

`--self-test` needs no database. It checks, in every language, that a correct program is accepted and a wrong
one isn't, and in Python that a crash, an endless loop, endless output and a memory hog get RE, TLE, OLE and MLE,
and in C that broken code is a compile error. `--self-test --language=java` checks one.

### In a container

```sh
sudo mkdir -p /var/lib/bogey-runner && sudo chown 1000 /var/lib/bogey-runner
docker build -t bogey-runner .
docker run -d --restart unless-stopped --name bogey-runner \
  -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/bogey-runner:/var/lib/bogey-runner \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  bogey-runner
```

The work directory is mounted at the **same path** on both sides because the runner asks the host's Docker to
mount it into the containers it starts. With the all-in-one stack, `deploy/all-in-one/compose.runner.yml` does this
and joins its network (`docker compose -f compose.yml -f compose.runner.yml up -d`).

**The Docker socket is root on the host.** Anything that can use it can start a privileged container. The runner is
small and doesn't run what it judges itself (that happens in containers with no network, no capabilities and a
read-only filesystem), but give it its own machine, or a rootless Docker or Podman, when the contest matters.

## How a judging goes

1. `challenges_claim_judging` hands over the oldest queued judging with a lease. The runner renews the lease while it works
   (`challenges_heartbeat`); if it's lost, the work is dropped and nothing is recorded. A lease that expires puts the
   judging back, and after three attempts it ends as a judgement error (`JE`).
2. The source is saved in a fresh directory as the language says (`main.py`, `Main.java`...). Languages that compile do it once, in a container
   with more time and memory (`BOGEY_RUNNER_COMPILE_*`). A compiler error, or a compiler that takes too long, is `CE`.
3. Each test runs in its own container: `--network none`, read-only root, a small `/tmp`, the solution mounted read-only,
   memory (with no swap), CPU and process limits, no capabilities, an unprivileged user. Tests run samples first, then in order.
4. Each run ends as one of:

   | Verdict | When                                                              |
   | ------- | ----------------------------------------------------------------- |
   | `AC`    | exit 0, in time, and the output passes the checker                |
   | `WA`    | exit 0 and the checker rejects the output                         |
   | `RE`    | the program exited non-zero                                       |
   | `TLE`   | it ran past the problem's time limit (wall clock)                 |
   | `MLE`   | the kernel killed it for using more memory than the limit         |
   | `OLE`   | it wrote more than the problem's output limit to stdout or stderr |
   | `CE`    | it didn't compile                                                 |
   | `JE`    | the problem is broken (no tests), or the runner kept failing      |

   The judging's verdict is the first failure, or `AC`. ICPC and golf stop at the first failure; IOI runs everything.

5. `challenges_record_judging` stores the verdict, the score (IOI), the slowest test, and every run with a short excerpt of its
   output (who may read those is the database's call: teams see their samples only).

Limits arrive from the database already clamped to the organization's limits, and the runner clamps them again to the host's
(`BOGEY_RUNNER_MAX_*`), so a problem can't ask for more than the machine is willing to give.

**Time is wall-clock, less the cost of starting a container.** The runner measures what starting and stopping a do-nothing container of
each image costs (the cheapest of three tries) and takes it off every run. JVM languages still pay for the JVM to start; give Java and
Kotlin problems a little room. It isn't a CPU-time measurement, so don't run more judgings at once than you have cores, or timings drift.
Memory use isn't measured, only whether the limit was hit.

## Checkers

- `exact`: line for line, ignoring trailing spaces and blank lines at the end. This is what the browser preview also uses.
- `tokens`: the same words, whatever whitespace is between them.
- `float`: like `tokens`, but numbers within the problem's tolerance, absolute or relative, are equal.
- `custom`: the jury's own program, in any language the plugin has. It is compiled once per judging and run for each test in its own container (read-only,
  no network), as Kattis' output validators are: `checker input answer feedback_dir < submission_output`. Exit **42** accepts, **43** rejects, anything else
  means the checker is broken, and the judging is handed back instead of blaming the team. In IOI scoring, a rejecting checker may write a number to
  `feedback_dir/score.txt` to give part of the test's points.

## IOI scoring

Tests carry `group_key` and `points`. A test with no `points` shares what is left of the problem's points equally (samples are worth nothing unless
given points). A problem's `test_groups` say how a group adds up: `{"g1": {"aggregation": "sum" | "min", "stopOnFail": true}}`.
`sum` (the default) scores the points of the tests passed. `min` is all or nothing, the largest `points` in the group. `stopOnFail` skips the rest of a group after its first failure.
A test with no group is its own.

## Settings

All in the environment.

| Variable                                                                               | Default             | What                                                             |
| -------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                            |                     | required                                                         |
| `BOGEY_RUNNER_ID`                                                                      | host and pid        | name in `runner_id`; set it, so a restart cleans up after itself |
| `BOGEY_RUNNER_CONCURRENCY`                                                             | 2                   | judgings at once                                                 |
| `BOGEY_RUNNER_POLL_MS`                                                                 | 2000                | wait when the queue is empty                                     |
| `BOGEY_RUNNER_LEASE_SECONDS`                                                           | 120                 | how long a claim lasts without a heartbeat                       |
| `BOGEY_RUNNER_WORK_DIR`                                                                | temp folder         | where files are made (the same path on the host)                 |
| `BOGEY_RUNNER_DOCKER`                                                                  | `docker`            | the CLI (set to `podman` for Podman)                             |
| `BOGEY_RUNNER_MAX_TIME_MS`, `_MAX_MEMORY_MB`, `_MAX_OUTPUT_KB`                         | 20000, 1024, 16384  | host ceilings on what a problem asks for                         |
| `BOGEY_RUNNER_CPUS`, `_PIDS`                                                           | 1, 128              | per test container                                               |
| `BOGEY_RUNNER_COMPILE_TIME_MS`, `_COMPILE_MEMORY_MB`, `_COMPILE_CPUS`, `_COMPILE_PIDS` | 60000, 2048, 2, 512 | for compiling                                                    |
| `BOGEY_RUNNER_BACKEND`                                                                 | `docker`            | the only sandbox in this version; any other value stops startup  |

On stop (SIGTERM) the runner hands judgings in hand back to the queue. On start it removes containers an earlier run of the same `BOGEY_RUNNER_ID` left behind.

## Languages

C, C++, Java, Kotlin, Python, JavaScript, Rust and Go. Each is a row in `challenges_languages` (image, source file, compile and run commands); add or change
one in SQL and, if it needs a toolchain, an image in `images/` that only contains the toolchain. The runner has no language-specific code.

## Developing

```sh
npm test         # node --test; a fake sandbox stands in for Docker
npm run check    # tsc
```

No dependencies at runtime. Node 22.18 or newer runs the TypeScript directly.
