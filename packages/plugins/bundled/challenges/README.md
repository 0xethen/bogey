# Challenges

Timed algorithmic problems, judged by a runner you host, with a live scoreboard; and capture the flag. It ships with Bogey
(`packages/plugins/bundled`, ADR 0026): `bogey db migrate` applies its tables, and an org or event turns it on like any
plugin. The runner is `tools/runner` and has its own [README](../../../../tools/runner/README.md).

## Statements

A problem's statement is Markdown typed on its page, or a PDF uploaded there instead (**Statement → Upload a PDF**, up to
20 MB). **Add limits** puts the problem's current time, memory and output limits at the end of the Markdown.

A PDF is kept with the problem's files, so participants can open it only while they could see the problem. The upload is
checked for a PDF header, the database only accepts a PDF stored in that problem's own folder (`1_statement_pdf.sql`),
and the page shows it from a copy typed as a PDF, so a file that isn't one can't run as a page.

## Problem packages

The jury can bring a problem in from a Kattis / ICPC problem package (a ZIP) and take one out, from the Jury
page. A package imported as a new problem is added hidden.

What is read:

| In the package                                                                              | Becomes                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `problem.yaml` `name`, `limits` (`time_limit` seconds, `memory` and `output` MB)            | Title and limits, kept inside what a problem may set             |
| `validation: default`                                                                       | Token comparison                                                 |
| `validation: default space_change_sensitive`                                                | Exact comparison                                                 |
| `validator_flags: float_tolerance X` (also in `data/testdata.yaml`)                         | Float comparison with tolerance `X`                              |
| `validation: custom` and one file in `output_validators/`                                   | A custom checker (42 accepts, 43 rejects, `score.txt` scores)    |
| `data/sample/*.in`, `.ans`                                                                  | Samples                                                          |
| `data/secret/**`                                                                            | Tests; a folder directly under `secret` is a group               |
| `testdata.yaml` `scoring.score`, `scoring.aggregation` (`sum` or `min`), `on_reject: break` | The group's points, how it adds up, and stopping after a failure |
| `statement/problem.en.md` (or any `problem.<lang>.md`)                                      | The statement                                                    |
| A PDF or LaTeX statement only                                                               | An attached file, with a placeholder statement                   |
| `attachments/`, other files in `statement/`                                                 | Files                                                            |
| `submissions/accepted`, `wrong_answer`, `time_limit_exceeded`, `run_time_error`             | Jury solutions (language by plugin, up to 30)                    |

Interactive problems are refused. A custom checker of several files, or one that includes a local header,
can't be used as it is. A package is limited to 5000 files, 16 MB a file and 128 MB unpacked, and the upload to
64 MB. Whatever is changed or left out is listed after the import.

"Replace from a package" on a problem swaps its statement, limits, checker and tests for the package's and
leaves submissions alone. A failed import of a new problem removes what it made; a failed replacement can leave
the problem partly updated, so run it again.

Export writes the same layout. A group's score is the largest points among its tests for `min` and their sum
for `sum`.

The routes are `POST /api/x/challenges/problem-package?event=<id>&label=<id>` (the ZIP as the body; `replace=<problem id>`
instead of `label` to replace) and `GET .../problem-package?event=<id>&problem=<id>`. They run as the caller, so only
the jury gets through.

## Contest API export

Jury → Contest data downloads the contest as one JSON document keyed by [ICPC Contest API](https://ccs-specs.icpc.io/)
endpoint: `contest`, `judgement-types`, `languages`, `problems`, `organizations` (empty: Bogey has none),
`teams`, `submissions`, `judgements`, `runs` and `scoreboard`. Jury solutions and ignored solutions are left out of the
scoreboard as they are on the live one. IDs are Bogey's own UUIDs, and `RE` is the Contest API's `RTE`.

`GET /api/x/challenges/contests/<event URL name>/scoreboard` answers with just the scoreboard, to anyone, while the
scoreboard window is open and the event is public (or the caller can view it). Two organizations that both have an
event of that name need `?org=<organization URL name>`. A frozen scoreboard stays frozen there too.

## Capture the flag

Pick **Capture the flag** when creating an event (the event's **Format** setting is `ctf`). It uses the same plugin, so
there is nothing else to install. Jeopardy-style: challenges with flags, categories, dynamic scoring, hints that cost
points, first blood and a team scoreboard.

1. Create the event. Add the **Contest** window on the agenda (challenges show and flags are accepted) and the
   **Scoreboard** window (the board teams can see). Organizers see everything at any time. If players form teams, open
   the Teams window as well.
2. **Edit challenges** (organizers): title, category, Markdown description, points, a flag and any hints.
3. Teams open **Challenges**, send flags, and watch **Scoreboard**.

### Flags

- **The exact flag** is stored as a SHA-256 hash with the challenge's id, so it can't be read back, not even by
  organizers. Keep your own copy. "Match case" off lowercases both sides.
- **Any flag matching a pattern** stores a POSIX regular expression (PostgreSQL syntax) that the whole flag has to match,
  for flags that differ per team. The pattern is stored, because it has to be.
- Wrong flags are limited per team and challenge each minute (`Wrong flags a team can send per challenge each minute`).
  Flag text is never stored, only that a try was made.

### Scoring

- **Fixed points** always award the starting points.
- **Points fall as teams solve it** uses CTFd's dynamic formula (reimplemented): the first solver's value is the
  starting points, falling on a parabola to the lowest points once `decay` more teams have solved it. Everyone who
  solved it holds the current value, so early solvers lose points as it gets solved. With 500 to 100 over 4 solves,
  two solves are worth 475.
- A **hint** with a cost takes that many points from the team that unlocks it, immediately and for good. Hints are numbered;
  editing a challenge's hint list renumbers them, so don't reorder hints once teams may have unlocked them.
- **First blood** is the first team to solve a challenge, shown on the challenge and counted on the board.
- **Freeze**: set a time and everyone but organizers sees the board, scores and dynamic values as they were then.

CTF teams don't have submissions, so this doesn't feed rounds or published results. Read the final order from the
scoreboard. `bogey seed demo` adds a demo CTF.

## Tests

`tests/*.test.ts` run with the plugins package's tests (`vp test` in `packages/plugins`): the package format, the Contest API
shapes and CTF categories. The fixtures are built in the test with `fflate`, not copied from another project's example problems.
The SQL tests in `tests/` run after `bogey db migrate` (CI runs them after core's pgTAP).
