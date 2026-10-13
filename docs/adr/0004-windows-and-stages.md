# 0004: Windows are the only authorization primitive; stages are derived

**Status:** accepted, 2026-09

## Context

The event lifecycle was modeled twice. `events.state` was an enum that
affected only display and a Discord trigger, and plugins had to add values
to it. `event_gates` was what RLS actually enforced. The two drifted:
organizers moved the stage, the gates didn't follow, and the other way
round.

## Decision

- **`event_windows(event_id, key, opens_at, closes_at, override)`** is the
  only answer to "is X allowed now?". RLS calls
  `private.window_open(event_id, key)`.
- **The stage is calculated, not stored.** The stage registry
  (`packages/plugins/src/stages.ts`, extended by plugins) lists each stage in
  lifecycle order, together with the windows that define it. The current
  stage is the last stage whose windows are all open. This is calculated in
  TypeScript for display.
- **"Advance stage" is a preset.** It is one RPC call that sets several
  windows' overrides or times at once, and it is audited as a single action.
- **Plugins add windows (`challenges.contest`), not enum values.**

## Consequences

- A scheduled event moves through its stages with no organizer action and
  no drift.
- Discord and webhook stage posts are driven by window transitions, found by
  a minute-level `pg_cron` job, instead of by a column update.
