import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vite-plus/test";
import { judge, type JudgeDeps } from "../src/judge.ts";
import type { ExecResult, ExecSpec, Sandbox } from "../src/sandbox.ts";
import { InfraError, type Claim, type Language, type Testcase } from "../src/types.ts";

const python: Language = {
  key: "python",
  image: "bogey-runner-python:3.13",
  source_file: "main.py",
  compile_cmd: null,
  run_cmd: "python3 main.py",
};
const cpp: Language = {
  key: "cpp",
  image: "bogey-runner-gcc:14",
  source_file: "main.cpp",
  compile_cmd: "g++ -O2 -o main main.cpp",
  run_cmd: "./main",
};

const ran = (stdout: string, extra: Partial<ExecResult> = {}): ExecResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
  elapsedMs: 40,
  timedOut: false,
  outputExceeded: false,
  ...extra,
});

class FakeSandbox implements Sandbox {
  calls: ExecSpec[] = [];
  files: string[] = [];
  behave: (spec: ExecSpec, call: number) => ExecResult | Promise<ExecResult>;

  constructor(behave: (spec: ExecSpec, call: number) => ExecResult | Promise<ExecResult>) {
    this.behave = behave;
  }

  async exec(spec: ExecSpec): Promise<ExecResult> {
    this.calls.push(spec);
    const work = spec.mounts[0];
    if (work && this.files.length === 0) this.files = await readdir(work.host);
    return this.behave(spec, this.calls.length - 1);
  }

  async cleanup(): Promise<void> {}
}

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "runner-test-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const tc = (id: string, extra: Partial<Testcase> = {}): Testcase => ({
  id,
  ordinal: 1,
  is_sample: false,
  group_key: null,
  points: null,
  ...extra,
});

function claim(
  extra: Partial<Claim> = {},
  tests: Testcase[] = [tc("t1"), tc("t2"), tc("t3")],
): Claim {
  return {
    judgingId: "j",
    eventId: "e",
    attempts: 1,
    solution: { id: "s", source: "print(1)" },
    language: python,
    problem: {
      id: "p",
      label: "A",
      time_limit_ms: 1000,
      memory_limit_mb: 128,
      output_limit_kb: 8,
      checker: "tokens",
      checker_tolerance: null,
      checker_source: null,
      checker_language: null,
      run_script: null,
      points: 100,
      test_groups: {},
    },
    scoring: "icpc",
    testcases: tests,
    ...extra,
  };
}

const LIMITS = {
  maxTimeMs: 5000,
  maxMemoryMb: 256,
  maxOutputKb: 16,
  cpus: 1,
  pids: 64,
  compileTimeMs: 10_000,
  compileMemoryMb: 512,
  compileCpus: 2,
  compilePids: 256,
  judgingTimeMs: 60_000,
};

const answers = (map: Record<string, string>): JudgeDeps["api"] => ({
  testData: async (_judging, id) => ({ input: `in-${id}`, answer: map[id] ?? "1" }),
});

function deps(sandbox: Sandbox, api: JudgeDeps["api"] = answers({})): JudgeDeps {
  return { api, sandbox, limits: LIMITS, workDir };
}

test("every test passing is AC, and the source is saved under the language's file name", async () => {
  const sandbox = new FakeSandbox(() => ran("1\n"));
  const outcome = await judge(claim(), deps(sandbox));
  assert.equal(outcome.verdict, "AC");
  assert.equal(outcome.runs.length, 3);
  assert.deepEqual(sandbox.files, ["main.py"]);
  assert.equal(sandbox.calls[0]?.stdin, "in-t1");
  assert.equal(
    sandbox.calls[0]?.mounts[0]?.writable,
    false,
    "tests run with the solution read-only",
  );
  assert.equal(outcome.score, null);
  assert.equal((await readdir(workDir)).length, 0, "the work files are removed");
});

test("ICPC stops at the first test that fails", async () => {
  const sandbox = new FakeSandbox((_, call) => ran(call === 1 ? "2\n" : "1\n"));
  const outcome = await judge(claim(), deps(sandbox));
  assert.equal(outcome.verdict, "WA");
  assert.equal(outcome.runs.length, 2, "the third test never ran");
});

test("limits are the problem's, never above the host's ceilings", async () => {
  const sandbox = new FakeSandbox(() => ran("1"));
  const big = claim();
  big.problem.time_limit_ms = 60_000;
  big.problem.memory_limit_mb = 9_000;
  big.problem.output_limit_kb = 99_999;
  await judge(big, deps(sandbox));
  const spec = sandbox.calls[0];
  assert.equal(spec?.timeMs, 5000);
  assert.equal(spec?.memoryMb, 256);
  assert.equal(spec?.maxOutputBytes, 16 * 1024);
});

test("each way a run can end has its verdict", async () => {
  const cases: [Partial<ExecResult>, string][] = [
    [{ timedOut: true, elapsedMs: 1200 }, "TLE"],
    [{ outputExceeded: true }, "OLE"],
    [{ exitCode: 137 }, "MLE"],
    [{ exitCode: 1, stderr: "Traceback" }, "RE"],
    [{ elapsedMs: 1500 }, "TLE"],
  ];
  for (const [result, verdict] of cases) {
    const outcome = await judge(
      claim({}, [tc("t1")]),
      deps(new FakeSandbox(() => ran("1", result))),
    );
    assert.equal(outcome.verdict, verdict, JSON.stringify(result));
  }
});

test("a run records its time (capped at the limit) and excerpts", async () => {
  const outcome = await judge(
    claim({}, [tc("t1")]),
    deps(new FakeSandbox(() => ran("x".repeat(9000), { elapsedMs: 700, stderr: "warn" }))),
  );
  const run = outcome.runs[0];
  assert.equal(run?.time_ms, 700);
  assert.equal(run?.output_excerpt?.length, 4000);
  assert.equal(run?.stderr_excerpt, "warn");
  assert.equal(outcome.maxTimeMs, 700);
});

test("a compile error stops everything and carries the compiler's words", async () => {
  const sandbox = new FakeSandbox(() =>
    ran("", { exitCode: 1, stderr: "main.cpp:1: error: oops" }),
  );
  const outcome = await judge(claim({ language: cpp }), deps(sandbox));
  assert.equal(outcome.verdict, "CE");
  assert.match(outcome.compileOutput, /oops/);
  assert.equal(outcome.runs.length, 0);
  assert.equal(sandbox.calls.length, 1);
  assert.equal(
    sandbox.calls[0]?.mounts[0]?.writable,
    true,
    "compiling writes its output beside the source",
  );
  assert.equal(sandbox.calls[0]?.memoryMb, 512, "with the compile limits");
});

test("a compiler that takes too long is a compile error", async () => {
  const outcome = await judge(
    claim({ language: cpp }),
    deps(new FakeSandbox(() => ran("", { timedOut: true }))),
  );
  assert.equal(outcome.verdict, "CE");
  assert.match(outcome.compileOutput, /too long/);
});

test("compiling once serves every test", async () => {
  const sandbox = new FakeSandbox(() => ran("1"));
  await judge(claim({ language: cpp }), deps(sandbox));
  assert.equal(sandbox.calls.filter((spec) => spec.command.startsWith("g++")).length, 1);
  assert.equal(sandbox.calls.length, 4);
});

test("a problem with no tests is a judgement error, not a pass", async () => {
  const outcome = await judge(claim({}, []), deps(new FakeSandbox(() => ran(""))));
  assert.equal(outcome.verdict, "JE");
  assert.match(outcome.compileOutput, /no tests/);
});

test("Docker failing is the host's fault: it is thrown, not turned into a verdict", async () => {
  const sandbox = new FakeSandbox(() => {
    throw new InfraError("docker: daemon is not running");
  });
  await assert.rejects(judge(claim(), deps(sandbox)), InfraError);
  assert.equal((await readdir(workDir)).length, 0, "and the files still go");
});

test("a source file name that could escape the directory is refused", async () => {
  const evil = claim({ language: { ...python, source_file: "../x.py" } });
  await assert.rejects(judge(evil, deps(new FakeSandbox(() => ran("1")))), InfraError);
});

test("IOI runs every test, scores the passed ones, and the verdict is the first failure", async () => {
  const tests = [tc("a", { points: 30 }), tc("b", { points: 30 }), tc("c", { points: 40 })];
  const sandbox = new FakeSandbox((_, call) => ran(call === 1 ? "no" : "1"));
  const outcome = await judge(claim({ scoring: "ioi" }, tests), deps(sandbox));
  assert.equal(outcome.runs.length, 3);
  assert.equal(outcome.verdict, "WA");
  assert.equal(outcome.score, 70);
});

test("IOI skips the rest of a group that stops at its first failure", async () => {
  const tests = [
    tc("a", { group_key: "g", points: 10 }),
    tc("b", { group_key: "g", points: 10 }),
    tc("c", { group_key: "h", points: 10 }),
  ];
  const c = claim({ scoring: "ioi" }, tests);
  c.problem.test_groups = { g: { aggregation: "sum", stopOnFail: true } };
  const outcome = await judge(c, deps(new FakeSandbox((_, call) => ran(call === 0 ? "no" : "1"))));
  assert.deepEqual(
    outcome.runs.map((run) => run.testcase_id),
    ["a", "c"],
  );
  assert.equal(outcome.score, 10);
});

test("a custom checker decides with the Kattis exit codes and may give partial points", async () => {
  const checker = { ...python, key: "python", source_file: "check.py" };
  const c = claim({ scoring: "ioi" }, [tc("a", { points: 100 })]);
  c.problem.checker = "custom";
  c.problem.checker_source = "import sys";
  c.problem.checker_language = checker;
  const seen: ExecSpec[] = [];
  const sandbox = new FakeSandbox(async (spec) => {
    seen.push(spec);
    if (spec.cwd === "/checker") {
      const files = spec.mounts.find((mount) => mount.container === "/case");
      const feedback = spec.mounts.find((mount) => mount.container === "/feedback");
      assert.equal(await readFile(join(files?.host ?? "", "output"), "utf-8"), "some output");
      await writeFile(join(feedback?.host ?? "", "score.txt"), "35\n");
      return ran("", { exitCode: 43 });
    }
    return ran("some output");
  });
  const outcome = await judge(c, deps(sandbox));
  assert.equal(outcome.runs[0]?.verdict, "WA");
  assert.equal(outcome.score, 35, "the checker's score.txt counts for a wrong-but-partial answer");
  const check = seen.find((spec) => spec.cwd === "/checker");
  assert.match(check?.command ?? "", /\/case\/input \/case\/answer \/feedback\/ < \/case\/output/);
  assert.deepEqual(
    check?.mounts.map((mount) => `${mount.container}:${mount.writable ? "rw" : "ro"}`),
    ["/checker:ro", "/case:ro", "/feedback:rw"],
    "the checker can write only its feedback folder",
  );
});

test("a checker's score.txt that is a link to another file is ignored", async () => {
  const c = claim({ scoring: "ioi" }, [tc("a", { points: 100 })]);
  c.problem.checker = "custom";
  c.problem.checker_source = "x";
  c.problem.checker_language = python;
  const secret = join(workDir, "..", `secret-${Date.now()}`);
  await writeFile(secret, "77");
  try {
    const sandbox = new FakeSandbox(async (spec) => {
      const feedback = spec.mounts.find((mount) => mount.container === "/feedback");
      if (feedback) {
        await symlink(secret, join(feedback.host, "score.txt"));
        return ran("", { exitCode: 43 });
      }
      return ran("out");
    });
    const outcome = await judge(c, deps(sandbox));
    assert.equal(outcome.score, 0);
  } finally {
    await rm(secret, { force: true });
  }
});

test("the whole judging has a deadline, and past it the judging goes back", async () => {
  const sandbox = new FakeSandbox(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return ran("1");
  });
  await assert.rejects(
    judge(claim(), { ...deps(sandbox), limits: { ...LIMITS, judgingTimeMs: 40 } }),
    /took longer than/,
  );
});

test("test data is asked for by the judging and the test", async () => {
  const asked: string[] = [];
  const sandbox = new FakeSandbox(() => ran("1"));
  await judge(claim({}, [tc("t1")]), {
    ...deps(sandbox),
    api: {
      testData: async (judging, id) => {
        asked.push(`${judging}/${id}`);
        return { input: "", answer: "1" };
      },
    },
  });
  assert.deepEqual(asked, ["j/t1"]);
});

test("a custom checker that crashes is the host's problem", async () => {
  const c = claim({}, [tc("a")]);
  c.problem.checker = "custom";
  c.problem.checker_source = "x";
  c.problem.checker_language = python;
  const sandbox = new FakeSandbox((spec) =>
    spec.cwd === "/checker" ? ran("", { exitCode: 1, stderr: "boom" }) : ran("out"),
  );
  await assert.rejects(judge(c, deps(sandbox)), /custom checker exited with 1/);
});

test("an aborted judging stops before the next test", async () => {
  const controller = new AbortController();
  const sandbox = new FakeSandbox((_, call) => {
    if (call === 0) controller.abort();
    return ran("1");
  });
  await assert.rejects(judge(claim(), { ...deps(sandbox), signal: controller.signal }));
  assert.equal(sandbox.calls.length, 1);
});

test("a run script runs the solution, and what it writes to its output file is the output", async () => {
  const sandbox = new FakeSandbox(async (spec) => {
    const io = spec.mounts.find((mount) => mount.container === "/io");
    const inDir = spec.mounts.find((mount) => mount.container === "/in");
    const script = spec.mounts.find((mount) => mount.container === "/script");
    assert.ok(io && inDir && script, "the script and the test's files are mounted");
    assert.equal(io.writable, true);
    assert.equal(inDir.writable, false, "the input can't be swapped for a link");
    assert.equal(script.writable, false);
    assert.equal(await readFile(join(script.host, "run"), "utf-8"), 'exec "$@" < "$1" > "$2"');
    const input = await readFile(join(inDir.host, "input"), "utf-8");
    await writeFile(join(io.host, "output"), input === "in-t2" ? "2\n" : "1\n");
    return ran("ignored\n");
  });
  const outcome = await judge(
    claim({ problem: { ...claim().problem, run_script: 'exec "$@" < "$1" > "$2"' } }),
    deps(sandbox),
  );
  assert.equal(sandbox.calls[0]?.command, "sh /script/run /in/input /io/output python3 main.py");
  assert.equal(sandbox.calls[0]?.stdin, "");
  assert.equal(outcome.verdict, "WA", "the second test's output came from the file");
  assert.equal(outcome.runs[0]?.output_excerpt, "1\n");
});

test("a run script writing more than the output limit is too much output", async () => {
  const sandbox = new FakeSandbox(async (spec) => {
    const io = spec.mounts.find((mount) => mount.container === "/io");
    if (io) await writeFile(join(io.host, "output"), "x".repeat(17 * 1024));
    return ran("");
  });
  const outcome = await judge(
    claim({ problem: { ...claim().problem, run_script: "true" } }, [tc("t1")]),
    deps(sandbox),
  );
  assert.equal(outcome.verdict, "OLE");
});

test("a run script's output that is a link reads as no output, never the link's target", async () => {
  const sandbox = new FakeSandbox(async (spec) => {
    const io = spec.mounts.find((mount) => mount.container === "/io");
    if (io) await symlink("/etc/hosts", join(io.host, "output"));
    return ran("");
  });
  const outcome = await judge(
    claim({ problem: { ...claim().problem, run_script: "true" } }, [tc("t1")]),
    deps(sandbox),
  );
  assert.equal(outcome.runs[0]?.output_excerpt, "");
  assert.equal(outcome.verdict, "WA");
});

test("a NUL byte in the output can't stop the verdict being stored", async () => {
  const outcome = await judge(
    claim({}, [tc("t1")]),
    deps(new FakeSandbox(() => ran("a\0b", { stderr: "\0" }))),
  );
  assert.equal(outcome.runs[0]?.output_excerpt, "a�b");
  assert.equal(outcome.runs[0]?.stderr_excerpt, "�");
});
