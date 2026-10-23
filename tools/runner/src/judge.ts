import { mkdir, rm } from "node:fs/promises";
import type { Api } from "./api.ts";
import { builtinMatch } from "./checkers.ts";
import type { HostLimits } from "./config.ts";
import { makeJobDir, readContained, safeName, writeNew } from "./paths.ts";
import { ioiScore, judgingVerdict, stopsGroup } from "./scoring.ts";
import { KILLED, type ExecResult, type ExecSpec, type Sandbox } from "./sandbox.ts";
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
const MB = 1024 * 1024;

export interface JudgeDeps {
  api: Pick<Api, "testData">;
  sandbox: Sandbox;
  limits: HostLimits;
  workDir: string;
  signal?: AbortSignal;
}

interface Step {
  deps: JudgeDeps;
  signal: AbortSignal;
}

const mb = (value: number, ceiling: number) => Math.min(value, ceiling);

function excerpt(text: string): string {
  return text.length > EXCERPT ? text.slice(0, EXCERPT) : text;
}

function compileOutputOf(result: ExecResult): string {
  return `${result.stdout}${result.stderr}`.trim().slice(0, COMPILE_OUTPUT);
}

function exec(step: Step, spec: ExecSpec): Promise<ExecResult> {
  step.signal.throwIfAborted();
  return step.deps.sandbox.exec(spec, step.signal);
}

async function compile(
  step: Step,
  language: Language,
  source: string,
  dir: string,
): Promise<string | null> {
  await writeNew(dir, safeName(language.source_file, `language ${language.key}`), source);
  if (!language.compile_cmd) return null;
  const { limits } = step.deps;
  const result = await exec(step, {
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
    fileSizeMb: 256,
    execTmp: true,
  });
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

/**
 * A custom checker gets, for each test, a fresh read-only folder with the input, the answer and
 * the team's output, and a fresh writable feedback folder. Nothing it writes is read back except
 * `score.txt`, and only as a plain file.
 */
async function check(
  step: Step,
  problem: Problem,
  checkerDir: string | null,
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
  if (!language || !checkerDir)
    throw new InfraError("the problem has a custom checker with no language");
  const { limits, workDir } = step.deps;
  const caseDir = await makeJobDir(workDir, "t-", false);
  const feedback = await makeJobDir(workDir, "f-", true);
  try {
    await writeNew(caseDir, "input", input);
    await writeNew(caseDir, "answer", answer);
    await writeNew(caseDir, "output", actual);
    const result = await exec(step, {
      image: language.image,
      command: `${language.run_cmd} /case/input /case/answer /feedback/ < /case/output`,
      cwd: "/checker",
      mounts: [
        { host: checkerDir, container: "/checker", writable: false },
        { host: caseDir, container: "/case", writable: false },
        { host: feedback, container: "/feedback", writable: true },
      ],
      stdin: "",
      timeMs: Math.min(limits.maxTimeMs, 10_000),
      memoryMb: Math.min(limits.maxMemoryMb, 512),
      cpus: limits.cpus,
      pids: limits.pids,
      maxOutputBytes: 64 * 1024,
      tmpfsMb: 64,
      fileSizeMb: 4,
    });
    if (result.exitCode !== CHECKER_ACCEPT && result.exitCode !== CHECKER_REJECT) {
      throw new InfraError(
        `the custom checker exited with ${result.exitCode}${result.timedOut ? " (out of time)" : ""}: ${(result.stderr || result.stdout).slice(0, 300)}`,
      );
    }
    const raw = await readContained(feedback, "score.txt", 64);
    const score = raw === null ? null : Number(raw.text.trim());
    return {
      accepted: result.exitCode === CHECKER_ACCEPT,
      score: score !== null && Number.isFinite(score) && score >= 0 ? score : null,
    };
  } finally {
    await Promise.all([caseDir, feedback].map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

/**
 * Runs the solution on one test. With a run script, the script runs it instead, DOMjudge's way:
 * `sh /script/run /in/input /io/output <run command...>` in the solution's image, and what it
 * writes to /io/output is the program's output. Its own stdout is ignored; its stderr is kept.
 */
async function runTest(
  step: Step,
  problem: Problem,
  language: Language,
  dirs: { work: string; script: string | null },
  input: string,
  limits: { timeMs: number; memoryMb: number; outputBytes: number },
): Promise<ExecResult> {
  const { deps } = step;
  const base = {
    image: language.image,
    cwd: "/work",
    timeMs: limits.timeMs,
    memoryMb: limits.memoryMb,
    cpus: deps.limits.cpus,
    pids: deps.limits.pids,
    maxOutputBytes: limits.outputBytes,
    tmpfsMb: 64,
    // one megabyte over the output limit, so a full output file still reads as too much output
    fileSizeMb: Math.ceil(limits.outputBytes / MB) + 1,
  };
  if (problem.run_script === null || !dirs.script) {
    return exec(step, {
      ...base,
      command: language.run_cmd,
      mounts: [{ host: dirs.work, container: "/work", writable: false }],
      stdin: input,
    });
  }
  const inDir = await makeJobDir(deps.workDir, "i-", false);
  const ioDir = await makeJobDir(deps.workDir, "o-", true);
  try {
    await writeNew(inDir, "input", input);
    const result = await exec(step, {
      ...base,
      command: `sh /script/run /in/input /io/output ${language.run_cmd}`,
      mounts: [
        { host: dirs.work, container: "/work", writable: false },
        { host: dirs.script, container: "/script", writable: false },
        { host: inDir, container: "/in", writable: false },
        { host: ioDir, container: "/io", writable: true },
      ],
      stdin: "",
    });
    const output = await readContained(ioDir, "output", limits.outputBytes);
    if (output?.truncated) return { ...result, stdout: "", outputExceeded: true };
    return { ...result, stdout: output?.text ?? "" };
  } finally {
    await Promise.all([inDir, ioDir].map((dir) => rm(dir, { recursive: true, force: true })));
  }
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

  // one deadline for the whole judging; past it the judging goes back to the queue
  const deadline = AbortSignal.timeout(limits.judgingTimeMs);
  const signal = deps.signal ? AbortSignal.any([deps.signal, deadline]) : deadline;
  const step: Step = { deps, signal };

  await mkdir(deps.workDir, { recursive: true, mode: 0o700 });
  const made: string[] = [];
  const dir = async (prefix: string, writable: boolean) => {
    const path = await makeJobDir(deps.workDir, prefix, writable);
    made.push(path);
    return path;
  };
  try {
    const work = await dir("j-", true);
    const failedCompile = await compile(step, language, claim.solution.source, work);
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
      checkerDir = await dir("c-", true);
      const failed = await compile(
        step,
        problem.checker_language,
        problem.checker_source,
        checkerDir,
      );
      if (failed !== null)
        throw new InfraError(`the custom checker doesn't compile: ${failed.slice(0, 500)}`);
    }
    let scriptDir: string | null = null;
    if (problem.run_script !== null) {
      scriptDir = await dir("s-", false);
      await writeNew(scriptDir, "run", problem.run_script);
    }

    const timeLimit = mb(problem.time_limit_ms, limits.maxTimeMs);
    const runs: Run[] = [];
    const partial = new Map<string, number>();
    const stopped = new Set<string>();
    let maxTime = 0;
    let stopAll = false;

    for (const test of claim.testcases) {
      if (stopAll) break;
      if (test.group_key !== null && stopped.has(test.group_key)) continue;
      signal.throwIfAborted();

      const data = await deps.api.testData(claim.judgingId, test.id);
      const result = await runTest(
        step,
        problem,
        language,
        { work, script: scriptDir },
        data.input,
        {
          timeMs: timeLimit,
          memoryMb: mb(problem.memory_limit_mb, limits.maxMemoryMb),
          outputBytes: mb(problem.output_limit_kb, limits.maxOutputKb) * 1024,
        },
      );

      let verdict = verdictOfRun(result, timeLimit);
      if (verdict === "check") {
        const checked = await check(
          step,
          problem,
          checkerDir,
          result.stdout,
          data.input,
          data.answer,
        );
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
  } catch (error) {
    if (deadline.aborted && !deps.signal?.aborted) {
      throw new InfraError(
        `the judging took longer than ${Math.round(limits.judgingTimeMs / 1000)} s in all (BOGEY_RUNNER_JUDGING_TIME_MS)`,
      );
    }
    throw error;
  } finally {
    await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })));
  }
}
