import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Api } from "./api.ts";
import { builtinMatch } from "./checkers.ts";
import type { HostLimits } from "./config.ts";
import { ioiScore, judgingVerdict, stopsGroup } from "./scoring.ts";
import { KILLED, type ExecResult, type Sandbox } from "./sandbox.ts";
import {
  InfraError,
  type Claim,
  type Language,
  type Outcome,
  type Problem,
  type Run,
  type Verdict,
} from "./types.ts";

const EXCERPT = 4_000;
const COMPILE_OUTPUT = 16_000;
const CHECKER_ACCEPT = 42;
const CHECKER_REJECT = 43;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

export interface JudgeDeps {
  api: Pick<Api, "testData">;
  sandbox: Sandbox;
  limits: HostLimits;
  workDir: string;
  signal?: AbortSignal;
}

const mb = (value: number, ceiling: number) => Math.min(value, ceiling);

function excerpt(text: string): string {
  return text.length > EXCERPT ? text.slice(0, EXCERPT) : text;
}

async function makeDir(parent: string, prefix: string): Promise<string> {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(parent, prefix));
  await chmod(dir, 0o777);
  return dir;
}

function compileOutputOf(result: ExecResult): string {
  return `${result.stdout}${result.stderr}`.trim().slice(0, COMPILE_OUTPUT);
}

async function compile(
  deps: JudgeDeps,
  language: Language,
  source: string,
  dir: string,
): Promise<string | null> {
  if (!SAFE_NAME.test(language.source_file)) {
    throw new InfraError(
      `language ${language.key} has an unusable source file name "${language.source_file}"`,
    );
  }
  await writeFile(join(dir, language.source_file), source, "utf-8");
  if (!language.compile_cmd) return null;
  const { limits } = deps;
  const result = await deps.sandbox.exec(
    {
      image: language.image,
      command: language.compile_cmd,
      cwd: "/work",
      mounts: [{ host: dir, container: "/work", writable: true }],
      stdin: "",
      timeMs: limits.compileTimeMs,
      memoryMb: limits.compileMemoryMb,
      cpus: limits.compileCpus,
      pids: limits.compilePids,
      maxOutputBytes: COMPILE_OUTPUT * 4,
      tmpfsMb: 256,
    },
    deps.signal,
  );
  if (result.timedOut) return "Compilation took too long.";
  if (result.outputExceeded) return "The compiler printed too much.";
  if (result.exitCode !== 0)
    return compileOutputOf(result) || `The compiler exited with ${result.exitCode}.`;
  return null;
}

interface CheckerResult {
  accepted: boolean;
  score: number | null;
}

class Checking {
  private readonly deps: JudgeDeps;
  private readonly caseDir: string;
  private readonly checkerDir: string | null;

  constructor(deps: JudgeDeps, caseDir: string, checkerDir: string | null) {
    this.deps = deps;
    this.caseDir = caseDir;
    this.checkerDir = checkerDir;
  }

  async check(
    problem: Problem,
    actual: string,
    input: string,
    answer: string,
  ): Promise<CheckerResult> {
    if (problem.checker !== "custom") {
      return {
        accepted: builtinMatch(problem.checker, actual, answer, problem.checker_tolerance),
        score: null,
      };
    }
    const language = problem.checker_language;
    if (!language || !this.checkerDir)
      throw new InfraError("the problem has a custom checker with no language");
    const feedback = join(this.caseDir, "feedback");
    await rm(feedback, { recursive: true, force: true });
    await mkdir(feedback, { mode: 0o777 });
    await chmod(feedback, 0o777);
    await writeFile(join(this.caseDir, "input"), input, "utf-8");
    await writeFile(join(this.caseDir, "answer"), answer, "utf-8");
    await writeFile(join(this.caseDir, "output"), actual, "utf-8");
    const { limits } = this.deps;
    const result = await this.deps.sandbox.exec(
      {
        image: language.image,
        command: `${language.run_cmd} /case/input /case/answer /case/feedback < /case/output`,
        cwd: "/checker",
        mounts: [
          { host: this.checkerDir, container: "/checker", writable: false },
          { host: this.caseDir, container: "/case", writable: true },
        ],
        stdin: "",
        timeMs: Math.min(limits.maxTimeMs, 10_000),
        memoryMb: Math.min(limits.maxMemoryMb, 512),
        cpus: limits.cpus,
        pids: limits.pids,
        maxOutputBytes: 64 * 1024,
        tmpfsMb: 64,
      },
      this.deps.signal,
    );
    if (result.exitCode !== CHECKER_ACCEPT && result.exitCode !== CHECKER_REJECT) {
      throw new InfraError(
        `the custom checker exited with ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 300)}`,
      );
    }
    const raw = await readFile(join(feedback, "score.txt"), "utf-8").catch(() => null);
    const score = raw === null ? null : Number(raw.trim());
    return {
      accepted: result.exitCode === CHECKER_ACCEPT,
      score: score !== null && Number.isFinite(score) && score >= 0 ? score : null,
    };
  }
}

/**
 * Runs the solution on one test. With a run script, the script runs it instead, DOMjudge's way:
 * `sh /script/run /io/input /io/output <run command...>` in the solution's image, and what it
 * writes to /io/output is the program's output. Its own stdout is ignored; its stderr is kept.
 */
async function runTest(
  deps: JudgeDeps,
  problem: Problem,
  language: Language,
  dirs: { work: string; script: string | null; io: string | null },
  input: string,
  limits: { timeMs: number; memoryMb: number; outputBytes: number },
): Promise<ExecResult> {
  const base = {
    image: language.image,
    cwd: "/work",
    timeMs: limits.timeMs,
    memoryMb: limits.memoryMb,
    cpus: deps.limits.cpus,
    pids: deps.limits.pids,
    maxOutputBytes: limits.outputBytes,
    tmpfsMb: 64,
  };
  if (problem.run_script === null || !dirs.script || !dirs.io) {
    return deps.sandbox.exec(
      {
        ...base,
        command: language.run_cmd,
        mounts: [{ host: dirs.work, container: "/work", writable: false }],
        stdin: input,
      },
      deps.signal,
    );
  }
  const output = join(dirs.io, "output");
  await rm(output, { force: true });
  await writeFile(join(dirs.io, "input"), input, "utf-8");
  const result = await deps.sandbox.exec(
    {
      ...base,
      command: `sh /script/run /io/input /io/output ${language.run_cmd}`,
      mounts: [
        { host: dirs.work, container: "/work", writable: false },
        { host: dirs.script, container: "/script", writable: false },
        { host: dirs.io, container: "/io", writable: true },
      ],
      stdin: "",
    },
    deps.signal,
  );
  const size = await stat(output).then(
    (info) => info.size,
    () => 0,
  );
  if (size > limits.outputBytes) return { ...result, stdout: "", outputExceeded: true };
  const stdout = size === 0 ? "" : await readFile(output, "utf-8");
  return { ...result, stdout };
}

function verdictOfRun(result: ExecResult, limitMs: number): Verdict | "check" {
  if (result.timedOut) return "TLE";
  if (result.outputExceeded) return "OLE";
  if (result.exitCode === KILLED) return "MLE";
  if (result.exitCode !== 0) return "RE";
  if (result.elapsedMs > limitMs) return "TLE";
  return "check";
}

export async function judge(claim: Claim, deps: JudgeDeps): Promise<Outcome> {
  const { problem, language } = claim;
  const { limits } = deps;
  if (claim.testcases.length === 0) {
    return {
      verdict: "JE",
      score: null,
      maxTimeMs: null,
      maxMemoryKb: null,
      compileOutput: "This problem has no tests, so there is nothing to judge a solution against.",
      runs: [],
    };
  }

  const dir = await makeDir(deps.workDir, "j-");
  const extra: string[] = [];
  try {
    const failedCompile = await compile(deps, language, claim.solution.source, dir);
    if (failedCompile !== null) {
      return {
        verdict: "CE",
        score: claim.scoring === "ioi" ? 0 : null,
        maxTimeMs: null,
        maxMemoryKb: null,
        compileOutput: failedCompile,
        runs: [],
      };
    }

    let checkerDir: string | null = null;
    if (problem.checker === "custom") {
      if (!problem.checker_language || problem.checker_source === null) {
        throw new InfraError("the problem has a custom checker with no source");
      }
      checkerDir = await makeDir(deps.workDir, "c-");
      extra.push(checkerDir);
      const failed = await compile(
        deps,
        problem.checker_language,
        problem.checker_source,
        checkerDir,
      );
      if (failed !== null)
        throw new InfraError(`the custom checker doesn't compile: ${failed.slice(0, 500)}`);
    }
    const caseDir = await makeDir(deps.workDir, "t-");
    extra.push(caseDir);
    let scriptDir: string | null = null;
    let ioDir: string | null = null;
    if (problem.run_script !== null) {
      scriptDir = await makeDir(deps.workDir, "s-");
      ioDir = await makeDir(deps.workDir, "i-");
      extra.push(scriptDir, ioDir);
      await writeFile(join(scriptDir, "run"), problem.run_script, "utf-8");
    }
    const checking = new Checking(deps, caseDir, checkerDir);

    const timeLimit = mb(problem.time_limit_ms, limits.maxTimeMs);
    const runs: Run[] = [];
    const partial = new Map<string, number>();
    const stopped = new Set<string>();
    let maxTime = 0;
    let stopAll = false;

    for (const test of claim.testcases) {
      if (stopAll) break;
      if (test.group_key !== null && stopped.has(test.group_key)) continue;
      deps.signal?.throwIfAborted();

      const data = await deps.api.testData(test.id);
      const result = await runTest(
        deps,
        problem,
        language,
        { work: dir, script: scriptDir, io: ioDir },
        data.input,
        {
          timeMs: timeLimit,
          memoryMb: mb(problem.memory_limit_mb, limits.maxMemoryMb),
          outputBytes: mb(problem.output_limit_kb, limits.maxOutputKb) * 1024,
        },
      );

      let verdict = verdictOfRun(result, timeLimit);
      if (verdict === "check") {
        const checked = await checking.check(problem, result.stdout, data.input, data.answer);
        verdict = checked.accepted ? "AC" : "WA";
        if (claim.scoring === "ioi" && checked.score !== null && !checked.accepted) {
          partial.set(test.id, checked.score);
        }
      }
      maxTime = Math.max(maxTime, Math.min(result.elapsedMs, timeLimit));
      runs.push({
        testcase_id: test.id,
        verdict,
        time_ms: Math.round(Math.min(result.elapsedMs, timeLimit)),
        memory_kb: null,
        output_excerpt: excerpt(result.stdout),
        stderr_excerpt: excerpt(result.stderr),
      });

      if (verdict !== "AC") {
        if (claim.scoring !== "ioi") stopAll = true;
        else if (stopsGroup(problem, test) && test.group_key !== null) stopped.add(test.group_key);
      }
    }

    const verdict = judgingVerdict(runs);
    return {
      verdict,
      score: claim.scoring === "ioi" ? ioiScore(problem, claim.testcases, runs, partial) : null,
      maxTimeMs: Math.round(maxTime),
      maxMemoryKb: null,
      compileOutput: "",
      runs,
    };
  } finally {
    await Promise.all([dir, ...extra].map((path) => rm(path, { recursive: true, force: true })));
  }
}
