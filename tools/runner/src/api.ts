import type { Config, Credential } from "./config.ts";
import {
  VERDICTS,
  type Checker,
  type Claim,
  type GroupRule,
  type Language,
  type Problem,
  type Run,
  type Scoring,
  type TestData,
  type Testcase,
  type Verdict,
} from "./types.ts";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Obj = { [key: string]: unknown };

function obj(value: unknown, what: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} should be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} should be text`);
  return value;
}

function num(value: unknown, what: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${what} should be a number`);
  return n;
}

function maybe<T>(value: unknown, read: (v: unknown) => T): T | null {
  return value === null || value === undefined ? null : read(value);
}

export function parseLanguage(value: unknown): Language {
  const o = obj(value, "language");
  return {
    key: text(o.key, "language.key"),
    image: text(o.image, "language.image"),
    source_file: text(o.source_file, "language.source_file"),
    compile_cmd: maybe(o.compile_cmd, (v) => text(v, "language.compile_cmd")),
    run_cmd: text(o.run_cmd, "language.run_cmd"),
  };
}

function parseGroups(value: unknown): Record<string, GroupRule> {
  if (value === null || value === undefined) return {};
  const groups: Record<string, GroupRule> = {};
  for (const [key, rule] of Object.entries(obj(value, "test_groups"))) {
    const r = obj(rule, `test_groups.${key}`);
    groups[key] = {
      aggregation: r.aggregation === "min" ? "min" : "sum",
      stopOnFail: r.stopOnFail === true,
    };
  }
  return groups;
}

function parseProblem(value: unknown): Problem {
  const o = obj(value, "problem");
  const checker = text(o.checker, "problem.checker");
  if (checker !== "exact" && checker !== "tokens" && checker !== "float" && checker !== "custom") {
    throw new Error(`unknown checker "${checker}"`);
  }
  return {
    id: text(o.id, "problem.id"),
    label: text(o.label, "problem.label"),
    time_limit_ms: num(o.time_limit_ms, "problem.time_limit_ms"),
    memory_limit_mb: num(o.memory_limit_mb, "problem.memory_limit_mb"),
    output_limit_kb: num(o.output_limit_kb, "problem.output_limit_kb"),
    checker: checker satisfies Checker,
    checker_tolerance: maybe(o.checker_tolerance, (v) => num(v, "problem.checker_tolerance")),
    checker_source: maybe(o.checker_source, (v) => text(v, "problem.checker_source")),
    checker_language: maybe(o.checker_language, parseLanguage),
    run_script: maybe(o.run_script, (v) => text(v, "problem.run_script")),
    points: num(o.points, "problem.points"),
    test_groups: parseGroups(o.test_groups),
  };
}

function parseTestcase(value: unknown): Testcase {
  const o = obj(value, "testcase");
  return {
    id: text(o.id, "testcase.id"),
    ordinal: num(o.ordinal, "testcase.ordinal"),
    is_sample: o.is_sample === true,
    group_key: maybe(o.group_key, (v) => text(v, "testcase.group_key")),
    points: maybe(o.points, (v) => num(v, "testcase.points")),
  };
}

function scoringOf(value: unknown): Scoring {
  return value === "ioi" || value === "golf" ? value : "icpc";
}

export function parseClaim(value: unknown): Claim {
  const o = obj(value, "claim");
  const solution = obj(o.solution, "solution");
  const testcases = o.testcases;
  if (!Array.isArray(testcases)) throw new Error("testcases should be a list");
  return {
    judgingId: text(o.judging_id, "judging_id"),
    eventId: text(o.event_id, "event_id"),
    attempts: o.attempts === undefined ? 1 : num(o.attempts, "attempts"),
    solution: {
      id: text(solution.id, "solution.id"),
      source: text(solution.source, "solution.source"),
    },
    language: parseLanguage(o.language),
    problem: parseProblem(o.problem),
    scoring: scoringOf(o.scoring),
    runAll: o.run_all === true,
    testcases: testcases.map(parseTestcase),
  };
}

export function isVerdict(value: unknown): value is Verdict {
  return VERDICTS.some((verdict) => verdict === value);
}

export interface Api {
  claim(): Promise<Claim | null>;
  heartbeat(judgingId: string): Promise<boolean>;
  record(judgingId: string, result: RecordedResult): Promise<boolean>;
  requeue(judgingId: string, reason: string): Promise<void>;
  release(judgingId: string): Promise<void>;
  testData(judgingId: string, testcaseId: string): Promise<TestData>;
}

export interface RecordedResult {
  verdict: Verdict;
  score: number | null;
  groupScores?: Readonly<Record<string, number>> | null;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  compileOutput: string;
  runs: Tuple<Run>;
}

// the database functions each credential calls; a runner key only reaches the `challenges_runner_*` ones
const FUNCTIONS = {
  key: {
    claim: "challenges_runner_claim",
    heartbeat: "challenges_runner_heartbeat",
    record: "challenges_runner_record",
    requeue: "challenges_runner_requeue",
    release: "challenges_runner_release",
  },
  service: {
    claim: "challenges_claim_judging",
    heartbeat: "challenges_heartbeat",
    record: "challenges_record_judging",
    requeue: "challenges_requeue_judging",
    release: "challenges_release_judging",
  },
} as const;

export const RUNNER_KEY_HEADER = "x-bogey-runner-key";

function headersFor(credential: Credential): Record<string, string> {
  if (credential.kind === "service") {
    return {
      apikey: credential.serviceKey,
      authorization: `Bearer ${credential.serviceKey}`,
    };
  }
  // the anon key only gets the request through the gateway; the runner key is what the database checks
  return {
    [RUNNER_KEY_HEADER]: credential.runnerKey,
    ...(credential.apiKey ? { apikey: credential.apiKey } : {}),
  };
}

export function createApi(
  config: Pick<Config, "supabaseUrl" | "credential" | "runnerId" | "leaseSeconds">,
  fetcher: typeof fetch = fetch,
): Api {
  const headers = { ...headersFor(config.credential), "content-type": "application/json" };
  const names = FUNCTIONS[config.credential.kind];

  async function call(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { ...headers, ...init.headers },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 300)}`);
    return body ? (JSON.parse(body) as unknown) : null;
  }

  const rpc = (name: string, args: Json) =>
    call(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

  return {
    async claim() {
      const result = await rpc(names.claim, {
        p_runner: config.runnerId,
        p_lease_seconds: config.leaseSeconds,
      });
      return result === null ? null : parseClaim(result);
    },
    async heartbeat(judgingId) {
      const result = await rpc(names.heartbeat, {
        p_judging: judgingId,
        p_runner: config.runnerId,
        p_lease_seconds: config.leaseSeconds,
      });
      return result === true;
    },
    async record(judgingId, result) {
      const recorded = await rpc(names.record, {
        p_judging: judgingId,
        p_runner: config.runnerId,
        p_verdict: result.verdict,
        p_score: result.score,
        p_max_time_ms: result.maxTimeMs,
        p_max_memory_kb: result.maxMemoryKb,
        p_compile_output: result.compileOutput,
        p_runs: result.runs.map((run) => ({ ...run })),
        // only when there are any, so a pass/fail judging still records on a database without p_groups
        ...(result.groupScores ? { p_groups: { ...result.groupScores } } : {}),
      });
      return recorded === true;
    },
    async requeue(judgingId, reason) {
      await rpc(names.requeue, {
        p_judging: judgingId,
        p_runner: config.runnerId,
        p_reason: reason.slice(0, 4000).replaceAll("\0", "\uFFFD"),
      });
    },
    async release(judgingId) {
      await rpc(names.release, { p_judging: judgingId, p_runner: config.runnerId });
    },
    async testData(judgingId, testcaseId) {
      if (config.credential.kind === "key") {
        const row = obj(
          await rpc("challenges_runner_test_data", {
            p_judging: judgingId,
            p_runner: config.runnerId,
            p_testcase: testcaseId,
          }),
          `test ${testcaseId}`,
        );
        return { input: text(row.input, "input"), answer: text(row.answer, "answer") };
      }
      const rows = await call(
        `challenges_testcases?id=eq.${encodeURIComponent(testcaseId)}&select=input,answer`,
        { method: "GET" },
      );
      const first = Array.isArray(rows) ? rows[0] : undefined;
      const row = obj(first, `test ${testcaseId}`);
      return { input: text(row.input, "input"), answer: text(row.answer, "answer") };
    },
  };
}
