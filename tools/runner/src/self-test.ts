import type { Config } from "./config.ts";
import { judge } from "./judge.ts";
import type { Logger } from "./runner.ts";
import type { Sandbox } from "./sandbox.ts";
import { InfraError, type Claim, type Language, type TestData, type Verdict } from "./types.ts";

interface Sample {
  language: Language;
  sum: string;
}

const lang = (
  key: string,
  image: string,
  source_file: string,
  compile_cmd: string | null,
  run_cmd: string,
): Language => ({ key, image, source_file, compile_cmd, run_cmd });

export const SAMPLES: Tuple<Sample> = [
  {
    language: lang("python", "bogey-runner-python:3.13", "main.py", null, "python3 main.py"),
    sum: "a, b = map(int, input().split())\nprint(a + b)\n",
  },
  {
    language: lang("javascript", "bogey-runner-node:22", "main.js", null, "node main.js"),
    sum: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n",
  },
  {
    language: lang(
      "c",
      "bogey-runner-gcc:14",
      "main.c",
      "gcc -O2 -std=c11 -o main main.c -lm",
      "./main",
    ),
    sum: '#include <stdio.h>\nint main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }\n',
  },
  {
    language: lang(
      "cpp",
      "bogey-runner-gcc:14",
      "main.cpp",
      "g++ -O2 -std=c++17 -o main main.cpp",
      "./main",
    ),
    sum: "#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << a + b << '\\n'; }\n",
  },
  {
    language: lang(
      "java",
      "bogey-runner-java:21",
      "Main.java",
      "javac Main.java",
      "java -Xss64m Main",
    ),
    sum: "import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner in = new Scanner(System.in); System.out.println(in.nextInt() + in.nextInt()); } }\n",
  },
  {
    language: lang(
      "kotlin",
      "bogey-runner-kotlin:2.1",
      "main.kt",
      "kotlinc main.kt -include-runtime -d main.jar",
      "java -Xss64m -jar main.jar",
    ),
    sum: 'fun main() {\n    val (a, b) = readLine()!!.split(" ").map { it.toInt() }\n    println(a + b)\n}\n',
  },
  {
    language: lang(
      "rust",
      "bogey-runner-rust:1.85",
      "main.rs",
      "rustc -O -o main main.rs",
      "./main",
    ),
    sum: 'use std::io::Read;\nfn main() { let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); let v: Vec<i64> = s.split_whitespace().map(|x| x.parse().unwrap()).collect(); println!("{}", v[0] + v[1]); }\n',
  },
  {
    language: lang("go", "bogey-runner-go:1.24", "main.go", "go build -o main main.go", "./main"),
    sum: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar a, b int\n\tfmt.Scan(&a, &b)\n\tfmt.Println(a + b)\n}\n',
  },
];

const INPUT: TestData = { input: "2 3\n", answer: "5\n" };

function claimFor(
  language: Language,
  source: string,
  answer: string,
  limits: { timeMs?: number; memoryMb?: number; outputKb?: number } = {},
): Claim {
  return {
    judgingId: "self-test",
    eventId: "self-test",
    attempts: 1,
    solution: { id: "self-test", source },
    language,
    problem: {
      id: "self-test",
      label: "T",
      time_limit_ms: limits.timeMs ?? 3_000,
      memory_limit_mb: limits.memoryMb ?? 256,
      output_limit_kb: limits.outputKb ?? 64,
      checker: "tokens",
      checker_tolerance: null,
      checker_source: null,
      checker_language: null,
      run_script: null,
      points: 100,
      test_groups: {},
    },
    scoring: "icpc",
    testcases: [
      { id: `case-${answer}`, ordinal: 1, is_sample: false, group_key: null, points: null },
    ],
  };
}

interface Case {
  name: string;
  language: Language;
  source: string;
  answer?: string;
  expect: Verdict;
  limits?: { timeMs?: number; memoryMb?: number; outputKb?: number };
}

export function cases(only?: string): Case[] {
  const all: Case[] = [];
  const python = SAMPLES.find((sample) => sample.language.key === "python");
  const c = SAMPLES.find((sample) => sample.language.key === "c");
  for (const sample of SAMPLES) {
    all.push({ name: "correct", language: sample.language, source: sample.sum, expect: "AC" });
    all.push({
      name: "wrong answer",
      language: sample.language,
      source: sample.sum,
      answer: "6\n",
      expect: "WA",
    });
  }
  if (python) {
    const { language } = python;
    all.push({ name: "crash", language, source: "raise SystemExit(3)\n", expect: "RE" });
    all.push({
      name: "too slow",
      language,
      source: "while True:\n    pass\n",
      expect: "TLE",
      limits: { timeMs: 500 },
    });
    all.push({
      name: "too much output",
      language,
      source: "while True:\n    print('x' * 1000)\n",
      expect: "OLE",
      limits: { timeMs: 5_000, outputKb: 16 },
    });
    all.push({
      name: "too much memory",
      language,
      source: "data = []\nwhile True:\n    data.append(bytearray(10_000_000))\n",
      expect: "MLE",
      limits: { timeMs: 10_000, memoryMb: 64 },
    });
  }
  if (c)
    all.push({
      name: "doesn't compile",
      language: c.language,
      source: "int main( {\n",
      expect: "CE",
    });
  return only ? all.filter((one) => one.language.key === only) : all;
}

export async function selfTest(options: {
  config: Config;
  sandbox: Sandbox;
  log: Logger;
  only?: string;
}): Promise<boolean> {
  const { config, sandbox, log, only } = options;
  const list = cases(only);
  if (list.length === 0) {
    log.error(`no language called "${only}"`);
    return false;
  }
  let ok = true;
  for (const one of list) {
    const answer = one.answer ?? INPUT.answer;
    const claim = claimFor(one.language, one.source, answer, one.limits);
    const started = Date.now();
    try {
      const outcome = await judge(claim, {
        api: { testData: async () => ({ input: INPUT.input, answer }) },
        sandbox,
        limits: config.limits,
        workDir: config.workDir,
      });
      const pass = outcome.verdict === one.expect;
      ok &&= pass;
      const note = pass
        ? ""
        : ` (wanted ${one.expect})${outcome.compileOutput ? `: ${outcome.compileOutput.slice(0, 200)}` : ""}`;
      log.info(
        `${pass ? "ok  " : "FAIL"} ${one.language.key}: ${one.name} -> ${outcome.verdict} in ${Date.now() - started} ms${note}`,
      );
    } catch (error) {
      ok = false;
      const reason = error instanceof Error ? error.message : String(error);
      const hint =
        error instanceof InfraError && /image|find/i.test(reason)
          ? " (build the images: images/build.sh)"
          : "";
      log.error(`FAIL ${one.language.key}: ${one.name}: ${reason}${hint}`);
    }
  }
  log.info(ok ? "all good" : "some checks failed");
  return ok;
}
