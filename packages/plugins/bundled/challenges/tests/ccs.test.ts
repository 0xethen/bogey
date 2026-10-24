import { expect, test } from "vite-plus/test";
import {
  ccsContest,
  ccsScoreboard,
  ccsSnapshot,
  parseBoard,
  relTime,
  type Board,
} from "../format/ccs.ts";

const contest = {
  id: "ev1",
  name: "Cup",
  startsAt: "2026-10-10T10:00:00.000Z",
  durationMs: 5 * 3_600_000,
  freezeMinutes: 60,
  penaltyMinutes: 20,
  penaltyUnit: "minutes" as const,
};

const board = (scoring: Board["scoring"] = "icpc"): Board => ({
  scoring,
  frozen: false,
  startedAt: contest.startsAt,
  problems: [{ id: "p1", label: "A", title: "Sum", points: 100 }],
  rows: [
    {
      team_id: "t1",
      team_name: "Amy",
      solved: 1,
      penalty: 35,
      score: 100,
      rank: 1,
      cells: [{ problem_id: "p1", solved: true, minutes: 15, attempts: 2, pending: 0, score: 100 }],
    },
  ],
});

test("relTime writes hours, minutes, seconds and milliseconds", () => {
  expect(relTime(0)).toBe("0:00:00.000");
  expect(relTime(3_723_004)).toBe("1:02:03.004");
  expect(relTime(-90_000)).toBe("-0:01:30.000");
});

test("the contest has its start, duration, freeze and penalty", () => {
  expect(ccsContest(contest)).toEqual({
    id: "ev1",
    name: "Cup",
    formal_name: "Cup",
    start_time: "2026-10-10T10:00:00.000Z",
    duration: "5:00:00.000",
    scoreboard_freeze_duration: "1:00:00.000",
    penalty_time: 20,
  });
});

test("an ICPC scoreboard reports solved and penalty time", () => {
  const out = ccsScoreboard(board(), contest, new Date("2026-10-10T11:00:00Z"));
  expect(out.contest_time).toBe("1:00:00.000");
  expect(out.state).toEqual({
    started: true,
    ended: false,
    frozen: false,
    thawed: false,
    finalized: false,
  });
  expect(out.rows[0]?.score).toEqual({ num_solved: 1, total_time: 35 });
  expect(out.rows[0]?.problems[0]).toEqual({
    problem_id: "p1",
    num_judged: 2,
    num_pending: 0,
    solved: true,
    time: 15,
  });
});

test("a contest counting seconds reports its times as RELTIME", () => {
  const timed = { ...contest, penaltyMinutes: 30, penaltyUnit: "seconds" as const };
  expect(ccsContest(timed).penalty_time).toBe("0:00:30.000");
  const seconds = board();
  seconds.rows = seconds.rows.map((row) => ({
    ...row,
    penalty: 935,
    cells: row.cells.map((cell) => ({ ...cell, seconds: 905 })),
  }));
  const out = ccsScoreboard(seconds, timed, new Date("2026-10-10T11:00:00Z"));
  expect(out.rows[0]?.score).toEqual({ num_solved: 1, total_time: "0:15:35.000" });
  expect(out.rows[0]?.problems[0]).toMatchObject({ time: "0:15:05.000" });
});

test("an IOI scoreboard reports scores, and the contest ends on time", () => {
  const out = ccsScoreboard(board("ioi"), contest, new Date("2026-10-10T16:00:00Z"));
  expect(out.state.ended).toBe(true);
  expect(out.rows[0]?.score).toEqual({ score: 100 });
});

test("parseBoard accepts the scoreboard function's answer and nothing else", () => {
  expect(parseBoard(board())).toBeTruthy();
  expect(parseBoard({ rows: 3 })).toBe(null);
  expect(parseBoard(null)).toBe(null);
});

test("the snapshot carries every endpoint", () => {
  const out = ccsSnapshot({
    contest,
    languages: [{ key: "python", name: "Python" }],
    problems: [{ id: "p1", timeLimitMs: 1500, tests: 4 }],
    teams: [{ id: "t1", name: "Amy" }],
    solutions: [
      {
        id: "s1",
        problemId: "p1",
        teamId: "t1",
        languageKey: "python",
        submittedAt: "2026-10-10T10:15:00.000Z",
      },
    ],
    judgings: [
      {
        id: "j1",
        solutionId: "s1",
        verdict: "RE",
        startedAt: "2026-10-10T10:15:01.000Z",
        finishedAt: "2026-10-10T10:15:02.000Z",
      },
    ],
    runs: [{ id: 7, judgingId: "j1", ordinal: 2, verdict: "RE", timeMs: 120 }],
    board: board(),
    now: new Date("2026-10-10T11:00:00Z"),
  });
  expect(out.problems).toEqual([
    { id: "p1", label: "A", name: "Sum", ordinal: 0, time_limit: 1.5, test_data_count: 4 },
  ]);
  expect(out.submissions[0]?.contest_time).toBe("0:15:00.000");
  expect(out.judgements[0]?.judgement_type_id).toBe("RTE");
  expect(out.judgements[0]?.end_contest_time).toBe("0:15:02.000");
  expect(out.runs[0]).toEqual({
    id: "7",
    judgement_id: "j1",
    ordinal: 2,
    judgement_type_id: "RTE",
    time: "2026-10-10T10:15:02.000Z",
    contest_time: "0:15:02.000",
    run_time: 0.12,
  });
  expect(out["judgement-types"].some((type) => type.id === "AC" && type.solved)).toBeTruthy();
  expect(Object.keys(out).sort()).toEqual([
    "contest",
    "judgement-types",
    "judgements",
    "languages",
    "organizations",
    "problems",
    "runs",
    "scoreboard",
    "submissions",
    "teams",
  ]);
});
