import { z } from "zod";
import type { Verdict } from "../db.ts";

const CellSchema = z.object({
  problem_id: z.string(),
  solved: z.boolean(),
  minutes: z.number().nullable(),
  attempts: z.number(),
  pending: z.number(),
  score: z.number().nullable(),
});

const BoardSchema = z.object({
  scoring: z.enum(["icpc", "ioi", "golf"]),
  frozen: z.boolean(),
  startedAt: z.string().nullable(),
  problems: z.array(
    z.object({ id: z.string(), label: z.string(), title: z.string(), points: z.number() }),
  ),
  rows: z.array(
    z.object({
      team_id: z.string(),
      team_name: z.string(),
      solved: z.number(),
      penalty: z.number(),
      score: z.number(),
      rank: z.number(),
      cells: z.array(CellSchema),
    }),
  ),
});

export type Board = z.infer<typeof BoardSchema>;

export function parseBoard(value: unknown): Board | null {
  const parsed = BoardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type CcsContest = {
  id: string;
  name: string;
  startsAt: string | null;
  durationMs: number | null;
  freezeMinutes: number;
  penaltyMinutes: number;
};

export type CcsSolution = {
  id: string;
  problemId: string;
  teamId: string;
  languageKey: string;
  submittedAt: string;
};

export type CcsJudging = {
  id: string;
  solutionId: string;
  verdict: Verdict | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CcsRun = {
  id: number;
  judgingId: string;
  ordinal: number;
  verdict: Verdict;
  timeMs: number | null;
};

export type CcsSnapshotInput = {
  contest: CcsContest;
  languages: Tuple<{ key: string; name: string }>;
  problems: Tuple<{ id: string; timeLimitMs: number; tests: number }>;
  teams: Tuple<{ id: string; name: string }>;
  solutions: Tuple<CcsSolution>;
  judgings: Tuple<CcsJudging>;
  runs: Tuple<CcsRun>;
  board: Board;
  now: Date;
};

export function relTime(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const total = Math.abs(Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${sign}${hours}:${two(minutes)}:${two(seconds)}.${String(millis).padStart(3, "0")}`;
}

const TYPES: Readonly<
  Record<Verdict, { id: string; name: string; penalty: boolean; solved: boolean }>
> = {
  AC: { id: "AC", name: "Correct", penalty: false, solved: true },
  WA: { id: "WA", name: "Wrong answer", penalty: true, solved: false },
  TLE: { id: "TLE", name: "Time limit exceeded", penalty: true, solved: false },
  MLE: { id: "MLE", name: "Memory limit exceeded", penalty: true, solved: false },
  RE: { id: "RTE", name: "Run-time error", penalty: true, solved: false },
  OLE: { id: "OLE", name: "Output limit exceeded", penalty: true, solved: false },
  CE: { id: "CE", name: "Compile error", penalty: false, solved: false },
  JE: { id: "JE", name: "Judging error", penalty: false, solved: false },
};

const typeId = (verdict: Verdict) => TYPES[verdict].id;

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

function contestTime(contest: CcsContest, at: string | null): string | null {
  if (at === null || contest.startsAt === null) return null;
  return relTime(new Date(at).getTime() - new Date(contest.startsAt).getTime());
}

export function ccsContest(contest: CcsContest) {
  return {
    id: contest.id,
    name: contest.name,
    formal_name: contest.name,
    start_time: iso(contest.startsAt),
    duration: contest.durationMs === null ? null : relTime(contest.durationMs),
    scoreboard_freeze_duration:
      contest.freezeMinutes > 0 ? relTime(contest.freezeMinutes * 60_000) : null,
    penalty_time: contest.penaltyMinutes,
  };
}

export function ccsScoreboard(board: Board, contest: CcsContest, now: Date) {
  const start = contest.startsAt === null ? null : new Date(contest.startsAt).getTime();
  const ended =
    start !== null && contest.durationMs !== null && now.getTime() >= start + contest.durationMs;
  const icpc = board.scoring === "icpc";
  return {
    time: now.toISOString(),
    contest_time: start === null ? null : relTime(now.getTime() - start),
    state: {
      started: start !== null && now.getTime() >= start,
      ended,
      frozen: board.frozen,
      thawed: false,
      finalized: false,
    },
    rows: board.rows.map((row) => ({
      rank: row.rank,
      team_id: row.team_id,
      score: icpc ? { num_solved: row.solved, total_time: row.penalty } : { score: row.score },
      problems: row.cells.map((cell) => ({
        problem_id: cell.problem_id,
        num_judged: cell.attempts,
        num_pending: cell.pending,
        solved: cell.solved,
        ...(icpc ? { time: cell.minutes } : { score: cell.score }),
      })),
    })),
  };
}

export function ccsSnapshot(input: CcsSnapshotInput) {
  const { contest } = input;
  const ordinal = new Map(input.board.problems.map((problem, index) => [problem.id, index]));
  const labels = new Map(input.board.problems.map((problem) => [problem.id, problem]));
  const solutionOf = new Map(input.solutions.map((solution) => [solution.id, solution]));
  const judgingOf = new Map(input.judgings.map((judging) => [judging.id, judging]));

  return {
    contest: ccsContest(contest),
    "judgement-types": Object.values(TYPES).map((type) => ({
      id: type.id,
      name: type.name,
      penalty: type.penalty,
      solved: type.solved,
    })),
    languages: input.languages.map((language) => ({ id: language.key, name: language.name })),
    problems: input.problems
      .filter((problem) => labels.has(problem.id))
      .map((problem) => {
        const info = labels.get(problem.id);
        return {
          id: problem.id,
          label: info?.label ?? "",
          name: info?.title ?? "",
          ordinal: ordinal.get(problem.id) ?? 0,
          time_limit: problem.timeLimitMs / 1000,
          test_data_count: problem.tests,
          ...(input.board.scoring === "icpc" ? {} : { points: info?.points ?? 0 }),
        };
      })
      .sort((a, b) => a.ordinal - b.ordinal),
    organizations: [],
    teams: input.teams.map((team) => ({ id: team.id, name: team.name, organization_id: null })),
    submissions: input.solutions.map((solution) => ({
      id: solution.id,
      language_id: solution.languageKey,
      problem_id: solution.problemId,
      team_id: solution.teamId,
      time: iso(solution.submittedAt),
      contest_time: contestTime(contest, solution.submittedAt),
    })),
    judgements: input.judgings
      .filter((judging) => solutionOf.has(judging.solutionId))
      .map((judging) => ({
        id: judging.id,
        submission_id: judging.solutionId,
        judgement_type_id: judging.verdict === null ? null : typeId(judging.verdict),
        start_time: iso(judging.startedAt),
        start_contest_time: contestTime(contest, judging.startedAt),
        end_time: iso(judging.finishedAt),
        end_contest_time: contestTime(contest, judging.finishedAt),
      })),
    runs: input.runs
      .filter((run) => judgingOf.has(run.judgingId))
      .map((run) => {
        const judging = judgingOf.get(run.judgingId);
        return {
          id: String(run.id),
          judgement_id: run.judgingId,
          ordinal: run.ordinal,
          judgement_type_id: typeId(run.verdict),
          time: iso(judging?.finishedAt ?? null),
          contest_time: contestTime(contest, judging?.finishedAt ?? null),
          run_time: run.timeMs === null ? null : run.timeMs / 1000,
        };
      }),
    scoreboard: ccsScoreboard(input.board, contest, input.now),
  };
}
