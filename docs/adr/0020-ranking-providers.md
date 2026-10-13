# 0020: Other ways to rank are plugins

**Status:** accepted (2026-10-10). Builds on [0007](0007-judging-pipeline.md).

## Context

Core judging is a rubric: judges score weighted criteria, optionally evened out per judge, in rounds,
with tracks, a popular vote and expo tables. Events want other methods too: pairwise comparison,
peer rating, a leaderboard scored by a program. Building each into core would grow the rubric
into something that is none of them well; leaving them to plugins needed a way for a plugin's scores
to take part in ranking, advancing, awards and publishing.

## Decision

- **A round has a method:** `judging_rounds.method`, `rubric` or `<plugin>.<method>`, chosen by an
  organizer once the plugin is on (a trigger enforces that and audits the change).
- **A plugin writes one score per entry** into `ranking_inputs(round, submission, provider, score,
  detail)`, through `private.set_ranking_input`, which its own `security definer` functions call after
  checking the caller. The helper is not granted to clients and refuses a round the provider doesn't rank,
  so a plugin cannot feed a round it wasn't chosen for, and nobody reads the table but organizers.
- **`rank_submissions` is the single place ranking happens.** For a plugin round it uses the stored scores,
  higher first; everything downstream (advancing the top N, awards, exports, the published snapshot, the
  results pages) works unchanged and also carries the method and the plugin's `detail`.
- **The plugin owns the judges' experience:** a `judgingPanel` slot replaces the rubric form for such a
  round. Assignments, windows and the queue stay core's.

## Consequences

- A method's math lives in the plugin, in SQL or code, and can change without a core release.
- Entries a method hasn't scored are absent from that round's ranking; the plugin decides what an
  unscored entry means.
- A score is a single number per entry. A method that keeps many inputs (every comparison, every
  peer rating) stores them in its own tables and writes the combined score.
- Calibration, conflicts and "minimum judges" are rubric features and don't apply to plugin rounds.
