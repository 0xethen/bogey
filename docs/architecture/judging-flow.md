# Judging flow

A judge's session is a list of steps built in `packages/db/src/queries/judging-flow.ts`
from their queue (`judgeQueueFn`) and the event's judging settings.

- `score`: one per project the judge is asked to score (their assignments, or every project
  when they have none; projects marked "Team absent" are left out). These are required, and
  `judgingProgress` counts them.
- `deliberate`: offered after the queue when deliberation is on and a flagged project includes
  the judge (`deliberation: "all"`, or they're assigned to it or scored it).
- `browse`: offered after the queue when `judging.browseProjects` is on and there are projects
  outside the judge's assignments.

Each kind comes from a builder in `JUDGING_STEP_BUILDERS`. To add a step (a survey, a calibration
round, a hand-off), add a builder and teach the judging index's `Finished` panel how to show it.
`nextToScore` and `queueNeighbours` drive the project page's next and previous buttons.

The browse setting only changes what the judging pages show; judges can still score any
submitted project the database lets them read.
