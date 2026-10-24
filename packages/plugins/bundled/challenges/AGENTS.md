---
name: bogey-judging-runner
description: Bogey (hackathon platform) challenges/judging conventions — the out-of-process runner in tools/runner (Docker sandboxing, claim/verdict flow), the challenges plugin's client-side preview runner, and judging domain rules. Use when editing tools/runner/src or packages/plugins/bundled/challenges.
---

# Bogey judging & runner conventions

> The runner (`tools/runner`) claims with `challenges_claim_judging()` and records with
> `challenges_record_judging()` (`migrations/0_schema.sql`). Older notes below that name
> `challenge_attempts` mean `challenges_solutions` and `challenges_judgings`.

> Since 2.4 the runner holds a runner key, not the service key (ADR 0033,
> `docs/self-hosting/runner-security.md`). It calls the `challenges_runner_*` wrappers in
> `migrations/9_runner_keys.sql` as `anon`, which check the key and call the functions above under
> the runner id `key:<name>/<id>`; it reads test data only through `challenges_runner_test_data`, for
> a judging it holds. Change claiming or recording in the wrapped functions, not the wrappers. Notes
> below that say the runner uses the service-role key describe the old path, which still works.
> Every sandbox the runner starts must pass `tools/runner/src/docker-policy.ts`, which the Docker
> proxy enforces; a new `docker run` flag needs a matching rule there.

> A claimed judging's `scoring` comes from the problem's type (`kind`): `partial` sends `"ioi"`
> (score each test), `shortest` sends `"golf"` and `pass_fail` sends `"icpc"`. The contest's own
> `scoring` setting only decides how the scoreboard ranks. A new problem's type comes from `defaultKind`
> (`"style"` follows `scoring`) in the `challenges_problem_kind` trigger, and `scoreFrom` picks whether a
> partial problem's best or last judged solution scores, or (`subtasks`) each test group's best points
> across solutions, from `challenges_judgings.group_scores` that the runner records (`p_groups`). The
> claim's `run_all` comes from `testRun`. The settings' SQL defaults live in
> `private.challenges_settings`; keep them equal to the manifest's.
>
> Scoring `golf` reaches the runner as `scoring: "golf"` in the claimed judging. A golf
> verdict is still all-or-nothing (accepted or not); the length is read from the solution's
> source in the database, so the runner needs no golf logic. Limits arrive already clamped to the
> organization's `challenges.*` limits.

## Runner architecture (`tools/runner/src`)

- Runner uses interval polling, not a Realtime/`postgres_changes` websocket —
  a websocket still needs poll-on-reconnect logic for missed events, so
  polling is required either way, and a contest's minutes-scale timing makes a
  few seconds of poll latency irrelevant. (See `.vault/.TODO-03.md` "Polling".)
- `claim_pending_attempt` RPC does an atomic
  `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`; a `null` return
  means "nothing claimable," the normal steady state, not an error.
- Retry/backoff wraps only the claim query, not the judging work itself —
  free resilience to transient PostgREST blips; judging concurrency is capped
  separately by the queuer.
- Hidden test content never leaves this process — `challenge_tests_select`
  already excludes it from the browser, and the runner reads with the
  service-role key specifically so a participant's session never touches that
  query.
- A sandbox failure (infra issue) must release the claim, never become a
  terminal verdict for the participant — a broken backend should be caught
  within one poll interval via operator logs, not sit for 5 minutes or score
  the participant unfairly.
- Verdict audit rows have no `actor_id` (service-role connections have none) —
  correctly shows as "System" since a machine judged it. `detail`
  (expected/actual sample output) is deliberately omitted from the audit log
  to avoid leaking test-case content to organizers who aren't judges; logging
  failures are swallowed since the verdict itself is already durably written.
- Final verdict picks the first failing reason in fixed priority order:
  sandbox failure, output-cap exceeded, crash, timeout, wrong answer;
  `accepted` only if every test passed.
- The runner's exact-match comparison (trimmed, `stdout.trim() ===
  expected_stdout.trim()`) must stay byte-for-byte identical to the client
  preview runner's check in
  `packages/plugins/bundled/challenges/preview-runner.ts` — there's no shared import
  between browser and Node runner, so a solution could preview-pass then
  fail (or vice versa) on the same sample if these drift.
- Languages are rows in `challenges_languages` (image, source file,
  compile/run commands) and arrive with each claimed judging, so adding a
  language needs no runner change. The runner's `VERDICTS`
  (`tools/runner/src/types.ts`) intentionally duplicates (doesn't import) the
  `challenges_verdict` enum, so `tools/runner` has no dependency on plugin
  code; change both together.
- Resource-limit config is read once at startup, instance-wide only (not
  per-event/per-problem); `challenge_problems.time_limit_ms` is the separate
  per-problem fairness knob, this config is an operational safety ceiling for
  the host machine.

## Docker sandbox backend

- One Docker image per language (not one multi-toolchain image) to minimize
  attack surface — a compromised Python sandbox has no C++ compiler to pivot
  through. Images are built/versioned in-repo (`images/`), never pulled from a
  third-party registry at judge time.
- Source is bind-mounted read-only at `/work/solution.<ext>`, not piped via
  stdin — the container's stdin is reserved for the test case's actual input;
  each image's `entrypoint.sh` expects the file at that fixed path.
- Wall-clock timeout is enforced by the Node process via `AbortController`,
  not delegated to Docker (`--stop-timeout` only affects `docker stop`, not
  the run itself) — this is what lets "timed out" be distinguished from
  "crashed." Each stdout/stderr stream is capped independently at
  `maxOutputBytes` (an infinite-print solution is a captured-output DoS, not
  just wasted CPU); exceeding the cap kills the process with a distinct
  outcome rather than silently truncating into `wrong_answer`.
- Docker is the only implemented/production backend; WASM (reusing the
  preview-runner worker's approach in a Node worker thread) and a third-party
  API (Piston) are documented-but-unbuilt alternatives (`.vault/.TODO-03.md`)
  — selecting either must fail loudly at startup, never silently judge
  nothing.

## Challenges plugin — client preview runner (`preview-runner.ts`)

- Run is a preview only — it never touches `challenges_solutions`, and its result is never
  a verdict (only the runner writes those).
- Code runs in a Worker inside a `sandbox="allow-scripts"` iframe: an opaque origin with no
  cookies, storage or access to the page or Bogey's API. A CSP lets it reach only the CDN
  Pyodide loads from. Never run code in the page's own origin: a same-origin worker can
  call server functions with the viewer's cookies.
- The worker is `workerMain.toString()`, so it must stay self-contained (no imports or
  outer variables). A run past its limit is stopped by throwing the iframe away.
- `sameOutput` (trailing whitespace aside) must match the runner's exact checker, or a
  solution can preview-pass and then fail.
- The jury's "Try a solution" runs the jury's own code against hidden tests in the same
  sandbox. Participants' code is never run in a jury member's browser.
- `cpp` and `java` can't run in the browser; the UI says so instead of faking support.

## Who sees what

- `challenges_attempt_tests(solution)` is the only way to a solution's per-test results:
  the jury sees inputs, answers and outputs; the team sees verdicts and times when
  `resultDetail` is `tests`, and inputs and outputs of samples only.
- `checker_source` isn't selectable by browsers (column grant); the runner reads it.
- Problems stay hidden until the contest window has opened, even with the scoreboard open, and
  again once it has closed unless `problemsAfterContest` is on.
- With `waitForJudging` (the default), a trigger on `challenges_solutions` refuses a team's
  solution while its last one to that problem is queued or running. It's a trigger because a
  plugin migration can't redefine `challenges_submit` (it names lockdown's function).

## Judging domain rules

- Standings poll only while something is `pending` for that participant, and
  stop once caught up — avoids an idle contest hall of tabs polling forever.
- Submission history explicitly shows "pending," never an empty/blank badge —
  verdicts arrive minutes late from an async runner, and conflating "not yet
  judged" with "failed" drives support confusion.
- Scoreboard never falls back to an email address for unnamed participants —
  no display name isn't consent to publish an address.
- Statement-view is logged once per problem per visit, not per accordion
  toggle — the audit question is "when did they first see it."

## Scripts, the bank and live updates

- `run_script` (POSIX sh, DOMjudge's `run input output program...`) and `checker_source` (the compare
  script) aren't selectable by browsers; the jury reads them with `challenges_scripts`. The runner gets
  `run_script` in its claim and runs it in the solution's image (`runTest` in `tools/runner/src/judge.ts`).
  The client preview runner never runs a run script.
- The problem bank (`challenges_bank_*`, org-scoped) holds copies, never shared rows: `challenges_bank_save`,
  `challenges_bank_use` and `challenges_problem_copy` all go through `private.challenges_copy_into`, which
  re-queues jury solutions in the new event. Statement PDFs and attachments live in event storage and
  aren't copied. A new problem column has to be added to the bank table and the copier too.
- Pages stay current through `useLiveContest` (`shared.tsx`): a public broadcast on `challenges:<event>`
  (any judging or problem change; the message is empty, pages refetch through RLS) and `postgres_changes`
  on `challenges_judgings` for the team's own solutions. Polling is only the fallback.
