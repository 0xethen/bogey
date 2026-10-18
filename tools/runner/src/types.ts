export const VERDICTS = ["AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "JE"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type Scoring = "icpc" | "ioi" | "golf";
export type Checker = "exact" | "tokens" | "float" | "custom";

export interface Language {
  key: string;
  image: string;
  source_file: string;
  compile_cmd: string | null;
  run_cmd: string;
}

export interface Testcase {
  id: string;
  ordinal: number;
  is_sample: boolean;
  group_key: string | null;
  points: number | null;
}

export interface GroupRule {
  aggregation: "sum" | "min";
  stopOnFail: boolean;
}

export interface Problem {
  id: string;
  label: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  output_limit_kb: number;
  checker: Checker;
  checker_tolerance: number | null;
  checker_source: string | null;
  checker_language: Language | null;
  /** DOMjudge's run script: POSIX sh, called as `run <input> <output> <program...>` */
  run_script: string | null;
  points: number;
  test_groups: Record<string, GroupRule>;
}

export interface Claim {
  judgingId: string;
  eventId: string;
  attempts: number;
  solution: { id: string; source: string };
  language: Language;
  problem: Problem;
  scoring: Scoring;
  testcases: Tuple<Testcase>;
}

export interface TestData {
  input: string;
  answer: string;
}

export interface Run {
  testcase_id: string;
  verdict: Verdict;
  time_ms: number | null;
  memory_kb: number | null;
  output_excerpt: string | null;
  stderr_excerpt: string | null;
}

export interface Outcome {
  verdict: Verdict;
  score: number | null;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  compileOutput: string;
  runs: Tuple<Run>;
}

export class InfraError extends Error {}
