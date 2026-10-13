# 0007: Solutions, judgings and runs, with runner leases

**Status:** accepted, 2026-09

## Context

The old `challenge_attempts` table was the wrong shape:

- The verdict was free text, with mixed spellings such as `backend-error`.
- Participants could insert rows with any verdict.
- There was no rejudge.
- Claims weren't owned by a runner, so two runners could both write a
  verdict.
- A failing attempt could be requeued forever.
- Per-problem limits were ignored.

## Decision

- **Solutions.** `challenges_solutions` is written only by
  `challenges_submit()`, which checks the window, the language, the team, the
  attempt limit and the lockdown requirement.
- **Judgings.** Each judging of a solution is a row in
  `challenges_judgings`. A rejudge adds a new row and marks the old one
  `valid = false`. The scoreboard reads the latest valid judging.
- **Leases.** `challenges_claim_judging(runner_id)` takes the oldest queued judging,
  round-robin across orgs, using `FOR UPDATE SKIP LOCKED`, and sets a lease.
  The runner extends the lease with heartbeats.
  `challenges_record_judging(judging_id, runner_id, ...)` succeeds only while that runner
  holds the lease. An expired lease is requeued, and after
  `max_attempts` the judging becomes `JE`.
- **Verdicts** form an enum: AC, WA, TLE, MLE, RE, CE, OLE, JE. `JE` never
  counts against a team.
- **Per-test-case results** go in `challenges_judging_runs`. Only jury
  members can read them, except that a team can read its own results on
  sample cases. The runner doesn't store stderr or diffs for hidden cases.

## Consequences

- The runner compiles once per judging, gets `CE` for free, and applies each
  problem's time, memory and output limits.
- Freeze, first-to-solve and rejudge all come from how the scoreboard
  function queries this data; none of them needs extra state.
