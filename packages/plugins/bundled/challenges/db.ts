import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { browserClient, browserClientFor } from "@bogey/db/browser";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "@bogey/db/errors";
import type { Json } from "@bogey/db/types";

export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "OLE" | "JE";
export type RejudgingStatus = "pending" | "applied" | "cancelled";
type JudgingStatus = "queued" | "running" | "done" | "failed";
type Checker = "exact" | "tokens" | "float" | "custom";
export type Difficulty = string;

export const DIFFICULTY_TONES = [
  "gray",
  "green",
  "amber",
  "red",
  "blue",
  "violet",
  "pink",
  "teal",
  "orange",
] as const;
export type DifficultyTone = (typeof DIFFICULTY_TONES)[number];

type DifficultyRow = {
  event_id: string;
  key: string;
  label: string;
  tone: DifficultyTone;
  sort: number;
};

/** Code golf by ranges: a solution up to `max` long scores `points` (the smallest range it fits). */
export type GolfBracket = { max: number; points: number };

type ProblemRow = {
  id: string;
  event_id: string;
  label: string;
  slug: string;
  title: string;
  statement_md: string;
  statement_pdf_path: string | null;
  time_limit_ms: number;
  memory_limit_mb: number;
  output_limit_kb: number;
  checker: Checker;
  checker_tolerance: number | null;
  checker_language: string | null;
  points: number;
  golf_brackets: GolfBracket[];
  visible: boolean;
  sort: number;
  difficulty: Difficulty | null;
  created_at: string;
  updated_at: string;
};

type TestcaseRow = {
  id: string;
  event_id: string;
  problem_id: string;
  ordinal: number;
  is_sample: boolean;
  group_key: string | null;
  points: number | null;
  input: string;
  answer: string;
  created_at: string;
};

type AttachmentRow = {
  id: string;
  event_id: string;
  problem_id: string;
  name: string;
  storage_path: string;
  created_at: string;
};

type LanguageRow = {
  key: string;
  name: string;
  version: string;
  image: string;
  source_file: string;
  compile_cmd: string | null;
  run_cmd: string;
  editor_mode: string;
  enabled: boolean;
  sort: number;
};

type SolutionRow = {
  id: string;
  event_id: string;
  problem_id: string;
  team_id: string | null;
  user_id: string | null;
  language_key: string;
  source: string;
  submitted_at: string;
  source_chars: number;
  source_bytes: number;
  source_chars_no_space: number;
  jury_label: string | null;
  expected_verdict: Verdict | null;
  ignored_at: string | null;
  ignored_reason: string | null;
};

type RejudgingRow = {
  id: string;
  event_id: string;
  reason: string;
  status: RejudgingStatus;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
};

type JudgingRow = {
  id: string;
  event_id: string;
  solution_id: string;
  status: JudgingStatus;
  runner_id: string | null;
  lease_expires_at: string | null;
  attempts: number;
  verdict: Verdict | null;
  score: number | null;
  max_time_ms: number | null;
  max_memory_kb: number | null;
  compile_output: string | null;
  valid: boolean;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  rejudging_id: string | null;
  verified_at: string | null;
};

type RunRow = {
  id: number;
  judging_id: string;
  testcase_id: string;
  verdict: Verdict;
  time_ms: number | null;
  memory_kb: number | null;
};

type Table<Row, Insert = Row> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

type ProblemInsert = Pick<ProblemRow, "event_id" | "label" | "slug" | "title"> &
  Partial<
    Pick<
      ProblemRow,
      | "statement_md"
      | "statement_pdf_path"
      | "time_limit_ms"
      | "memory_limit_mb"
      | "output_limit_kb"
      | "points"
      | "golf_brackets"
      | "visible"
      | "sort"
      | "difficulty"
      | "checker"
      | "checker_tolerance"
      | "checker_language"
    >
  > & {
    checker_source?: string | null;
    test_groups?: Json;
  };

type TestcaseInsert = Pick<
  TestcaseRow,
  "event_id" | "problem_id" | "ordinal" | "is_sample" | "input" | "answer"
> &
  Partial<Pick<TestcaseRow, "points" | "group_key">>;

type AttachmentInsert = Pick<AttachmentRow, "event_id" | "problem_id" | "name" | "storage_path">;

export type TestResult = {
  ordinal: number;
  is_sample: boolean;
  verdict: Verdict;
  time_ms: number | null;
  memory_kb: number | null;
  input: string | null;
  answer: string | null;
  output: string | null;
  stderr: string | null;
};

export type ChallengesDatabase = {
  public: {
    Tables: {
      challenges_problems: Table<ProblemRow, ProblemInsert>;
      challenges_testcases: Table<TestcaseRow, TestcaseInsert>;
      challenges_attachments: Table<AttachmentRow, AttachmentInsert>;
      challenges_languages: Table<LanguageRow>;
      challenges_difficulties: Table<DifficultyRow>;
      challenges_solutions: Table<SolutionRow>;
      challenges_judgings: Table<JudgingRow>;
      challenges_rejudgings: Table<RejudgingRow>;
      challenges_judging_runs: Table<RunRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      challenges_problem_samples: {
        Args: { p_problem: string };
        Returns: { ordinal: number; input: string; answer: string }[];
      };
      challenges_submit: {
        Args: { p_problem: string; p_language: string; p_source: string };
        Returns: string;
      };
      challenges_scoreboard: { Args: { p_event: string; p_jury?: boolean }; Returns: Json };
      challenges_rejudge: {
        Args: {
          p_event: string;
          p_reason: string;
          p_solution?: string;
          p_problem?: string;
          p_team?: string;
          p_language?: string;
        };
        Returns: { id: string; count: number };
      };
      challenges_rejudging_diff: {
        Args: { p_rejudging: string };
        Returns: {
          solution_id: string;
          problem_id: string;
          team_id: string;
          language_key: string;
          submitted_at: string;
          old_verdict: Verdict | null;
          old_score: number | null;
          new_verdict: Verdict | null;
          new_score: number | null;
          new_status: JudgingStatus;
        }[];
      };
      challenges_apply_rejudging: { Args: { p_rejudging: string }; Returns: number };
      challenges_cancel_rejudging: { Args: { p_rejudging: string }; Returns: undefined };
      challenges_set_ignored: {
        Args: { p_solution: string; p_ignored: boolean; p_reason?: string };
        Returns: undefined;
      };
      challenges_verify_judgings: {
        Args: { p_event: string; p_judgings?: string[] };
        Returns: number;
      };
      challenges_add_jury_solution: {
        Args: {
          p_problem: string;
          p_language: string;
          p_source: string;
          p_expected: Verdict;
          p_label: string;
        };
        Returns: string;
      };
      challenges_remove_jury_solution: { Args: { p_solution: string }; Returns: undefined };
      challenges_verify_problem: { Args: { p_problem: string }; Returns: number };
      challenges_attempt_tests: { Args: { p_solution: string }; Returns: TestResult[] };
      challenges_set_testcases: { Args: { p_problem: string; p_cases: Json }; Returns: number };
      challenges_checker_source: {
        Args: { p_problem: string };
        Returns: {
          checker_source: string | null;
          checker_language: string | null;
          test_groups: Json;
        }[];
      };
      challenges_log_ccs_export: { Args: { p_event: string }; Returns: undefined };
      challenges_log_package: {
        Args: { p_problem: string; p_imported: boolean; p_tests: number };
        Returns: undefined;
      };
    };
    Enums: {
      challenges_checker: Checker;
      challenges_judging_status: JudgingStatus;
      challenges_rejudging_status: RejudgingStatus;
      challenges_verdict: Verdict;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

const client = () => browserClientFor<ChallengesDatabase>();

const BUCKET = "attachments";

export type Problem = Pick<
  ProblemRow,
  | "id"
  | "label"
  | "slug"
  | "title"
  | "statement_md"
  | "statement_pdf_path"
  | "time_limit_ms"
  | "memory_limit_mb"
  | "output_limit_kb"
  | "points"
  | "golf_brackets"
  | "difficulty"
  | "visible"
  | "sort"
>;

const PROBLEM_COLUMNS =
  "id, label, slug, title, statement_md, statement_pdf_path, time_limit_ms, memory_limit_mb, output_limit_kb, points, golf_brackets, difficulty, visible, sort";

export const problemsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["challenges", "problems", eventId] as const,
    queryFn: async (): Promise<Problem[]> => {
      const { data, error } = await client()
        .from("challenges_problems")
        .select(PROBLEM_COLUMNS)
        .eq("event_id", eventId);
      return unwrap(error ? toFailure(error, "loading the problems") : ok(data ?? []));
    },
    retry: retryPolicy,
  });

export interface ContestOverview {
  problems: number;
  hidden: number;
  solutions: number;
  waiting: number;
}

export const contestOverviewQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["challenges", "overview", eventId] as const,
    queryFn: async (): Promise<ContestOverview> => {
      const count = { count: "exact", head: true } as const;
      const [problems, hidden, solutions, waiting] = await Promise.all([
        client().from("challenges_problems").select("id", count).eq("event_id", eventId),
        client()
          .from("challenges_problems")
          .select("id", count)
          .eq("event_id", eventId)
          .eq("visible", false),
        client()
          .from("challenges_solutions")
          .select("id", count)
          .eq("event_id", eventId)
          .not("team_id", "is", null)
          .is("ignored_at", null),
        client()
          .from("challenges_judgings")
          .select("id", count)
          .eq("event_id", eventId)
          .in("status", ["queued", "running"]),
      ]);
      const error = problems.error ?? hidden.error ?? solutions.error ?? waiting.error;
      return unwrap(
        error
          ? toFailure(error, "loading the contest overview")
          : ok({
              problems: problems.count ?? 0,
              hidden: hidden.count ?? 0,
              solutions: solutions.count ?? 0,
              waiting: waiting.count ?? 0,
            }),
      );
    },
    retry: retryPolicy,
  });

export type DifficultyDef = Pick<DifficultyRow, "key" | "label" | "tone" | "sort">;

export const difficultiesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["challenges", "difficulties", eventId] as const,
    queryFn: async (): Promise<DifficultyDef[]> => {
      const { data, error } = await client()
        .from("challenges_difficulties")
        .select("key, label, tone, sort")
        .eq("event_id", eventId)
        .order("sort")
        .order("label");
      return unwrap(error ? toFailure(error, "loading the difficulties") : ok(data ?? []));
    },
    retry: retryPolicy,
  });

export async function saveDifficulties(
  eventId: string,
  next: Tuple<Omit<DifficultyDef, "sort">>,
): Promise<void> {
  const { data: current, error: readError } = await client()
    .from("challenges_difficulties")
    .select("key")
    .eq("event_id", eventId);
  if (readError) unwrap(toFailure(readError, "saving the difficulties"));
  const keep = new Set(next.map((each) => each.key));
  const removed = (current ?? []).map((each) => each.key).filter((key) => !keep.has(key));
  if (removed.length > 0) {
    const { error } = await client()
      .from("challenges_difficulties")
      .delete()
      .eq("event_id", eventId)
      .in("key", removed);
    if (error) unwrap(toFailure(error, "saving the difficulties"));
  }
  if (next.length > 0) {
    const { error } = await client()
      .from("challenges_difficulties")
      .upsert(
        next.map((each, index) => ({
          event_id: eventId,
          key: each.key,
          label: each.label,
          tone: each.tone,
          sort: index,
        })),
        { onConflict: "event_id,key" },
      );
    if (error) unwrap(toFailure(error, "saving the difficulties"));
  }
}

export type Language = Pick<LanguageRow, "key" | "name" | "version" | "editor_mode">;

export const languagesQueryOptions = () =>
  queryOptions({
    queryKey: ["challenges", "languages"] as const,
    queryFn: async (): Promise<Language[]> => {
      const { data, error } = await client()
        .from("challenges_languages")
        .select("key, name, version, editor_mode")
        .eq("enabled", true)
        .order("sort");
      return unwrap(error ? toFailure(error, "loading the languages") : ok(data ?? []));
    },
    staleTime: Infinity,
    retry: retryPolicy,
  });

export type Sample =
  ChallengesDatabase["public"]["Functions"]["challenges_problem_samples"]["Returns"][number];

export const samplesQueryOptions = (problemId: string) =>
  queryOptions({
    queryKey: ["challenges", "samples", problemId] as const,
    queryFn: async (): Promise<Sample[]> => {
      const { data, error } = await client().rpc("challenges_problem_samples", {
        p_problem: problemId,
      });
      return unwrap(error ? toFailure(error, "loading the samples") : ok(data ?? []));
    },
    retry: retryPolicy,
  });

export type Attachment = Pick<AttachmentRow, "id" | "name" | "storage_path">;

export const attachmentsQueryOptions = (problemId: string) =>
  queryOptions({
    queryKey: ["challenges", "attachments", problemId] as const,
    queryFn: async (): Promise<Attachment[]> => {
      const { data, error } = await client()
        .from("challenges_attachments")
        .select("id, name, storage_path")
        .eq("problem_id", problemId)
        .order("name");
      return unwrap(error ? toFailure(error, "loading the files") : ok(data ?? []));
    },
    retry: retryPolicy,
  });

export async function attachmentUrl(path: string): Promise<string> {
  const { data, error } = await browserClient().storage.from(BUCKET).createSignedUrl(path, 600);
  return unwrap(error || !data ? toFailure(error, "opening the file") : ok(data.signedUrl));
}

export interface Attempt {
  id: string;
  problemId: string;
  teamId: string;
  ignored: boolean;
  ignoredReason: string | null;
  verified: boolean;
  language: string;
  submittedAt: string;
  status: JudgingStatus | null;
  verdict: Verdict | null;
  score: number | null;
  timeMs: number | null;
  compileOutput: string | null;
  chars: number;
  bytes: number;
  charsNoSpace: number;
}

async function attempts(
  filter: { eventId: string; problemId?: string; solutionId?: string },
  limit: number,
): Promise<DbResult<Attempt[]>> {
  let query = client()
    .from("challenges_solutions")
    .select(
      "id, problem_id, team_id, language_key, submitted_at, source_chars, source_bytes, source_chars_no_space, ignored_at, ignored_reason",
    )
    .eq("event_id", filter.eventId)
    .not("team_id", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (filter.problemId) query = query.eq("problem_id", filter.problemId);
  if (filter.solutionId) query = query.eq("id", filter.solutionId);
  const solutions = await query;
  if (solutions.error) return toFailure(solutions.error, "loading solutions");
  const ids = (solutions.data ?? []).map((solution) => solution.id);
  if (ids.length === 0) return ok([]);
  const judgings = await client()
    .from("challenges_judgings")
    .select(
      "solution_id, status, verdict, score, max_time_ms, compile_output, queued_at, valid, verified_at",
    )
    .in("solution_id", ids)
    .order("queued_at", { ascending: false });
  if (judgings.error) return toFailure(judgings.error, "loading verdicts");
  return ok(
    (solutions.data ?? []).map((solution) => {
      const own = (judgings.data ?? []).filter((each) => each.solution_id === solution.id);
      const judging = own.find((each) => each.valid) ?? own[0];
      const finished = judging?.status === "done" || judging?.status === "failed";
      return {
        id: solution.id,
        problemId: solution.problem_id,
        teamId: solution.team_id ?? "",
        ignored: solution.ignored_at !== null,
        ignoredReason: solution.ignored_reason,
        verified: judging?.verified_at != null,
        language: solution.language_key,
        submittedAt: solution.submitted_at,
        status: judging?.status ?? null,
        verdict: finished ? (judging?.verdict ?? null) : null,
        score: judging?.score ?? null,
        timeMs: judging?.max_time_ms ?? null,
        compileOutput: judging?.compile_output ?? null,
        chars: solution.source_chars,
        bytes: solution.source_bytes,
        charsNoSpace: solution.source_chars_no_space,
      };
    }),
  );
}

export const myAttemptsQueryOptions = (eventId: string, problemId: string) =>
  queryOptions({
    queryKey: ["challenges", "attempts", eventId, problemId] as const,
    queryFn: async () => unwrap(await attempts({ eventId, problemId }, 50)),
    retry: retryPolicy,
  });

export const recentAttemptsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["challenges", "attempts", eventId, "all"] as const,
    queryFn: async () => unwrap(await attempts({ eventId }, 100)),
    retry: retryPolicy,
  });

export const attemptQueryOptions = (eventId: string, solutionId: string) =>
  queryOptions({
    queryKey: ["challenges", "attempt", solutionId] as const,
    queryFn: async () => unwrap(await attempts({ eventId, solutionId }, 1)).at(0) ?? null,
    retry: retryPolicy,
  });

export const attemptTestsQueryOptions = (solutionId: string) =>
  queryOptions({
    queryKey: ["challenges", "attempt-tests", solutionId] as const,
    queryFn: async (): Promise<TestResult[]> => {
      const { data, error } = await client().rpc("challenges_attempt_tests", {
        p_solution: solutionId,
      });
      return unwrap(error ? toFailure(error, "loading test results") : ok(data ?? []));
    },
    retry: retryPolicy,
  });

export const teamNamesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["challenges", "teams", eventId] as const,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await browserClient()
        .from("teams")
        .select("id, name")
        .eq("event_id", eventId);
      const rows = unwrap(error ? toFailure(error, "loading teams") : ok(data ?? []));
      return new Map(rows.map((team) => [team.id, team.name]));
    },
    retry: retryPolicy,
  });

const cell = z.object({
  problem_id: z.string(),
  solved: z.boolean(),
  minutes: z.number().nullable(),
  attempts: z.number(),
  pending: z.number(),
  score: z.number().nullable(),
  length: z.number().nullable().optional(),
  place: z.number().nullable().optional(),
  first: z.boolean(),
});

const scoreboardSchema = z.object({
  scoring: z.enum(["icpc", "ioi", "golf"]),
  measure: z.enum(["characters", "bytes", "characters-no-space"]).optional(),
  golfPoints: z.enum(["length", "brackets", "ratio", "rank"]).optional(),
  frozen: z.boolean(),
  freezeAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  problems: z.array(
    z.object({ id: z.string(), label: z.string(), title: z.string(), points: z.number() }),
  ),
  rows: z.array(
    z.object({
      rank: z.number(),
      team_id: z.string(),
      team_name: z.string(),
      solved: z.number(),
      penalty: z.number(),
      score: z.number(),
      total_length: z.number().optional(),
      cells: z.array(cell),
    }),
  ),
});

export type Scoreboard = z.output<typeof scoreboardSchema>;

export const scoreboardQueryOptions = (eventId: string, jury: boolean) =>
  queryOptions({
    queryKey: ["challenges", "scoreboard", eventId, jury] as const,
    queryFn: async (): Promise<Scoreboard> => {
      const { data, error } = await client().rpc("challenges_scoreboard", {
        p_event: eventId,
        p_jury: jury,
      });
      if (error) return unwrap(toFailure(error, "loading the scoreboard"));
      return scoreboardSchema.parse(data);
    },
    retry: retryPolicy,
  });

export async function submitSolution(input: {
  problemId: string;
  language: string;
  source: string;
}): Promise<string> {
  const { data, error } = await client().rpc("challenges_submit", {
    p_problem: input.problemId,
    p_language: input.language,
    p_source: input.source,
  });
  return unwrap(error ? toFailure(error, "submitting") : ok(data));
}

export interface Rejudging {
  id: string;
  reason: string;
  status: RejudgingStatus;
  createdAt: string;
  appliedAt: string | null;
}

export async function rejudge(input: {
  eventId: string;
  reason: string;
  solutionId?: string;
  problemId?: string;
  teamId?: string;
  language?: string;
}): Promise<{ id: string; count: number }> {
  const { data, error } = await client().rpc("challenges_rejudge", {
    p_event: input.eventId,
    p_reason: input.reason,
    ...(input.solutionId ? { p_solution: input.solutionId } : {}),
    ...(input.problemId ? { p_problem: input.problemId } : {}),
    ...(input.teamId ? { p_team: input.teamId } : {}),
    ...(input.language ? { p_language: input.language } : {}),
  });
  return unwrap(error ? toFailure(error, "queueing a rejudge") : ok(data));
}

export const rejudgingsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["challenges", "rejudgings", eventId] as const,
    queryFn: async (): Promise<Rejudging[]> => {
      const { data, error } = await client()
        .from("challenges_rejudgings")
        .select("id, reason, status, created_at, applied_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(20);
      return unwrap(
        error
          ? toFailure(error, "loading rejudgings")
          : ok(
              (data ?? []).map((row) => ({
                id: row.id,
                reason: row.reason,
                status: row.status,
                createdAt: row.created_at,
                appliedAt: row.applied_at,
              })),
            ),
      );
    },
    retry: retryPolicy,
  });

export interface RejudgingChange {
  solutionId: string;
  problemId: string;
  teamId: string | null;
  language: string;
  submittedAt: string;
  oldVerdict: Verdict | null;
  oldScore: number | null;
  newVerdict: Verdict | null;
  newScore: number | null;
  done: boolean;
}

export const rejudgingDiffQueryOptions = (rejudgingId: string) =>
  queryOptions({
    queryKey: ["challenges", "rejudging-diff", rejudgingId] as const,
    queryFn: async (): Promise<RejudgingChange[]> => {
      const { data, error } = await client().rpc("challenges_rejudging_diff", {
        p_rejudging: rejudgingId,
      });
      return unwrap(
        error
          ? toFailure(error, "loading the rejudging")
          : ok(
              (data ?? []).map((row) => ({
                solutionId: row.solution_id,
                problemId: row.problem_id,
                teamId: row.team_id,
                language: row.language_key,
                submittedAt: row.submitted_at,
                oldVerdict: row.old_verdict,
                oldScore: row.old_score,
                newVerdict: row.new_verdict,
                newScore: row.new_score,
                done: row.new_status === "done" || row.new_status === "failed",
              })),
            ),
      );
    },
    retry: retryPolicy,
  });

export async function applyRejudging(rejudgingId: string): Promise<number> {
  const { data, error } = await client().rpc("challenges_apply_rejudging", {
    p_rejudging: rejudgingId,
  });
  return unwrap(error ? toFailure(error, "applying the rejudging") : ok(data));
}

export async function cancelRejudging(rejudgingId: string): Promise<void> {
  const { error } = await client().rpc("challenges_cancel_rejudging", { p_rejudging: rejudgingId });
  unwrap(error ? toFailure(error, "cancelling the rejudging") : ok(null));
}

export async function setIgnored(input: {
  solutionId: string;
  ignored: boolean;
  reason?: string;
}): Promise<void> {
  const { error } = await client().rpc("challenges_set_ignored", {
    p_solution: input.solutionId,
    p_ignored: input.ignored,
    p_reason: input.reason ?? "",
  });
  unwrap(error ? toFailure(error, "ignoring the solution") : ok(null));
}

export async function verifyJudgings(eventId: string): Promise<number> {
  const { data, error } = await client().rpc("challenges_verify_judgings", { p_event: eventId });
  return unwrap(error ? toFailure(error, "verifying results") : ok(data));
}

export interface JurySolution {
  id: string;
  problemId: string;
  label: string;
  language: string;
  expected: Verdict;
  verdict: Verdict | null;
  status: JudgingStatus | null;
  source: string;
}

export const jurySolutionsQueryOptions = (eventId: string, problemId: string) =>
  queryOptions({
    queryKey: ["challenges", "jury-solutions", eventId, problemId] as const,
    queryFn: async (): Promise<JurySolution[]> => {
      const solutions = await client()
        .from("challenges_solutions")
        .select("id, problem_id, language_key, source, expected_verdict, jury_label, submitted_at")
        .eq("event_id", eventId)
        .eq("problem_id", problemId)
        .is("team_id", null)
        .order("submitted_at");
      if (solutions.error) return unwrap(toFailure(solutions.error, "loading jury solutions"));
      const ids = (solutions.data ?? []).map((row) => row.id);
      const judgings =
        ids.length === 0
          ? { data: [], error: null }
          : await client()
              .from("challenges_judgings")
              .select("solution_id, status, verdict, queued_at")
              .in("solution_id", ids)
              .order("queued_at", { ascending: false });
      if (judgings.error) return unwrap(toFailure(judgings.error, "loading jury solutions"));
      return (solutions.data ?? []).flatMap((row) => {
        if (!row.expected_verdict) return [];
        const judging = (judgings.data ?? []).find((each) => each.solution_id === row.id);
        const finished = judging?.status === "done" || judging?.status === "failed";
        return [
          {
            id: row.id,
            problemId: row.problem_id,
            label: row.jury_label ?? "",
            language: row.language_key,
            expected: row.expected_verdict,
            verdict: finished ? (judging?.verdict ?? null) : null,
            status: judging?.status ?? null,
            source: row.source,
          },
        ];
      });
    },
    retry: retryPolicy,
  });

export async function addJurySolution(input: {
  problemId: string;
  language: string;
  source: string;
  expected: Verdict;
  label: string;
}): Promise<string> {
  const { data, error } = await client().rpc("challenges_add_jury_solution", {
    p_problem: input.problemId,
    p_language: input.language,
    p_source: input.source,
    p_expected: input.expected,
    p_label: input.label,
  });
  return unwrap(error ? toFailure(error, "adding the solution") : ok(data));
}

export async function removeJurySolution(solutionId: string): Promise<void> {
  const { error } = await client().rpc("challenges_remove_jury_solution", {
    p_solution: solutionId,
  });
  unwrap(error ? toFailure(error, "removing the solution") : ok(null));
}

export async function verifyProblem(problemId: string): Promise<number> {
  const { data, error } = await client().rpc("challenges_verify_problem", { p_problem: problemId });
  return unwrap(error ? toFailure(error, "verifying the problem") : ok(data));
}

export type ProblemDraft = Omit<Problem, "id" | "statement_pdf_path">;

export async function saveProblem(
  eventId: string,
  id: string | null,
  draft: ProblemDraft,
): Promise<string> {
  const values = { ...draft, event_id: eventId };
  const result = id
    ? await client().from("challenges_problems").update(values).eq("id", id).select("id").single()
    : await client().from("challenges_problems").insert(values).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") {
      return unwrap(fail("invalid", "Another problem already has that ID or URL name."));
    }
    return unwrap(toFailure(result.error, "saving the problem"));
  }
  return result.data.id;
}

export async function saveProblemOrder(ids: Tuple<string>): Promise<void> {
  const results = await Promise.all(
    ids.map((id, index) =>
      client().from("challenges_problems").update({ sort: index }).eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) unwrap(toFailure(failed.error, "saving the order"));
}

export async function deleteProblem(id: string): Promise<void> {
  const { error } = await client().from("challenges_problems").delete().eq("id", id);
  unwrap(error ? toFailure(error, "removing the problem") : ok(null));
}

export type Testcase = Pick<
  TestcaseRow,
  "id" | "ordinal" | "is_sample" | "input" | "answer" | "points"
>;

export const testcasesQueryOptions = (problemId: string) =>
  queryOptions({
    queryKey: ["challenges", "testcases", problemId] as const,
    queryFn: async (): Promise<Testcase[]> => {
      const { data, error } = await client()
        .from("challenges_testcases")
        .select("id, ordinal, is_sample, input, answer, points")
        .eq("problem_id", problemId)
        .order("ordinal");
      return unwrap(error ? toFailure(error, "loading test cases") : ok(data ?? []));
    },
    retry: retryPolicy,
  });

export async function saveTestcases(
  problemId: string,
  cases: Tuple<Pick<Testcase, "is_sample" | "input" | "answer" | "points">>,
): Promise<number> {
  const { data, error } = await client().rpc("challenges_set_testcases", {
    p_problem: problemId,
    p_cases: cases.map((each) => ({
      is_sample: each.is_sample,
      input: each.input,
      answer: each.answer,
      points: each.points,
    })),
  });
  return unwrap(error ? toFailure(error, "saving test cases") : ok(data));
}

const FILE_NAME = /^[\w][\w .()-]{0,99}$/;

export async function addAttachment(eventId: string, problemId: string, file: File): Promise<void> {
  if (!FILE_NAME.test(file.name)) {
    unwrap(fail("invalid", "Use a file name of letters, digits, spaces, dots and dashes."));
  }
  if (file.size > 20 * 1024 * 1024) unwrap(fail("invalid", "Files can be up to 20 MB."));
  const path = `${eventId}/${problemId}/${file.name}`;
  const upload = await browserClient()
    .storage.from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
  if (upload.error) unwrap(toFailure(upload.error, "uploading the file"));
  const { error } = await client()
    .from("challenges_attachments")
    .upsert(
      { event_id: eventId, problem_id: problemId, name: file.name, storage_path: path },
      { onConflict: "storage_path" },
    );
  unwrap(error ? toFailure(error, "saving the file") : ok(null));
}

const PDF_BYTES = 20 * 1024 * 1024;

// The file must start like a PDF; its name and the browser's guess at its type prove nothing.
export async function isPdf(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

export async function uploadStatementPdf(
  eventId: string,
  problemId: string,
  file: File,
): Promise<string> {
  if (file.size > PDF_BYTES) unwrap(fail("invalid", "The PDF can be up to 20 MB."));
  if (!(await isPdf(file))) unwrap(fail("invalid", "That file isn't a PDF."));
  const path = `${eventId}/${problemId}/statement-${crypto.randomUUID()}.pdf`;
  const upload = await browserClient()
    .storage.from(BUCKET)
    .upload(path, file, { upsert: false, contentType: "application/pdf" });
  if (upload.error) unwrap(toFailure(upload.error, "uploading the PDF"));
  return path;
}

export async function setStatementPdf(
  problemId: string,
  path: string | null,
  previous: string | null,
): Promise<void> {
  const { error } = await client()
    .from("challenges_problems")
    .update({ statement_pdf_path: path })
    .eq("id", problemId);
  if (error) {
    if (path) await browserClient().storage.from(BUCKET).remove([path]);
    unwrap(toFailure(error, "saving the statement PDF"));
  }
  if (previous && previous !== path) await browserClient().storage.from(BUCKET).remove([previous]);
}

export const statementPdfQueryOptions = (path: string) =>
  queryOptions({
    queryKey: ["challenges", "statement-pdf", path] as const,
    queryFn: async (): Promise<Blob> => {
      const { data, error } = await browserClient().storage.from(BUCKET).download(path);
      if (error) return unwrap(toFailure(error, "loading the statement"));
      if (!(await isPdf(data))) return unwrap(fail("invalid", "The statement file isn't a PDF."));
      // Typed here, not by the server, so the browser can only ever open it as a PDF.
      return new Blob([data], { type: "application/pdf" });
    },
    staleTime: Infinity,
    retry: retryPolicy,
  });

export async function removeAttachment(attachment: Attachment): Promise<void> {
  const stored = await browserClient().storage.from(BUCKET).remove([attachment.storage_path]);
  if (stored.error) unwrap(toFailure(stored.error, "removing the file"));
  const { error } = await client().from("challenges_attachments").delete().eq("id", attachment.id);
  unwrap(error ? toFailure(error, "removing the file") : ok(null));
}

const PackageImportSchema = z.object({
  problemId: z.string(),
  slug: z.string(),
  tests: z.number(),
  attachments: z.number(),
  solutions: z.number(),
  warnings: z.array(z.string()),
});
export type PackageImport = z.infer<typeof PackageImportSchema>;

const PackageErrorSchema = z.object({ error: z.string() });
const PACKAGE_ROUTE = "/api/x/challenges/problem-package";

export async function importProblemPackage(
  eventId: string,
  file: File,
  target: { label: string } | { replace: string },
): Promise<PackageImport> {
  const query = new URLSearchParams({ event: eventId });
  if ("replace" in target) query.set("replace", target.replace);
  else query.set("label", target.label);
  const response = await fetch(`${PACKAGE_ROUTE}?${query}`, { method: "POST", body: file });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = PackageErrorSchema.safeParse(body);
    return unwrap(
      fail(
        "invalid",
        failure.success ? failure.data.error : "The server couldn't read that package.",
      ),
    );
  }
  const parsed = PackageImportSchema.safeParse(body);
  if (!parsed.success) return unwrap(fail("invalid", "The server's answer wasn't understood."));
  return parsed.data;
}

export const problemPackageUrl = (eventId: string, problemId: string) =>
  `${PACKAGE_ROUTE}?${new URLSearchParams({ event: eventId, problem: problemId })}`;

export const ccsExportUrl = (eventId: string) =>
  `/api/x/challenges/ccs-export?${new URLSearchParams({ event: eventId })}`;
