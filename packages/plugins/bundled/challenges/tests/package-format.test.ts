import { expect, test } from "vite-plus/test";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
  PackageError,
  languageForFile,
  parseYaml,
  readPackage,
  safeFileName,
  writePackage,
  type ProblemPackage,
} from "../format/package-format.ts";

const zip = (files: Record<string, string>): Uint8Array => {
  const entries: Zippable = {};
  for (const [path, content] of Object.entries(files)) entries[path] = strToU8(content);
  return zipSync(entries);
};

const basic = {
  "problem.yaml": "name: Sum\nlimits:\n  time_limit: 1.5\n  memory: 512\n",
  "data/sample/1.in": "1 2\n",
  "data/sample/1.ans": "3\n",
  "data/secret/a.in": "2 3\n",
  "data/secret/a.ans": "5\n",
  "statement/problem.en.md": "Add two numbers.",
};

test("parseYaml reads maps, lists, flow values and comments", () => {
  expect(
    parseYaml(
      [
        "# a comment",
        "name: {en: Hello, sv: Hej}",
        "tags: [a, 'b c', 3]",
        "limits:",
        "  time: 2 # seconds",
        "  nested:",
        "    - one",
        "    - two",
        'quoted: "x: y"',
        "flag: true",
        "nothing:",
      ].join("\n"),
    ),
  ).toEqual({
    name: { en: "Hello", sv: "Hej" },
    tags: ["a", "b c", 3],
    limits: { time: 2, nested: ["one", "two"] },
    quoted: "x: y",
    flag: true,
    nothing: null,
  });
});

test("parseYaml reads block scalars and refuses tabs", () => {
  expect(parseYaml("text: |\n  line one\n  line two\nnext: 1")).toEqual({
    text: "line one\nline two",
    next: 1,
  });
  expect(() => parseYaml("a:\n\tb: 1")).toThrow(PackageError);
});

test("a basic package becomes limits, samples, tests and a statement", () => {
  const read = readPackage(zip(basic));
  expect(read.name).toBe("Sum");
  expect(read.timeLimitMs).toBe(1500);
  expect(read.memoryLimitMb).toBe(512);
  expect(read.checker).toBe("tokens");
  expect(read.statementMd).toBe("Add two numbers.");
  expect(read.tests.map((each) => [each.isSample, each.input, each.answer, each.groupKey])).toEqual(
    [
      [true, "1 2\n", "3\n", null],
      [false, "2 3\n", "5\n", null],
    ],
  );
  expect(read.points).toBe(null);
});

test("a package inside one folder reads the same", () => {
  const nested = Object.fromEntries(
    Object.entries(basic).map(([path, text]) => [`sum/${path}`, text]),
  );
  expect(readPackage(zip(nested)).name).toBe("Sum");
});

test("validation flags pick the checker", () => {
  const withFlags = (extra: string) =>
    readPackage(zip({ ...basic, "problem.yaml": `name: X\n${extra}\n` }));
  expect(withFlags("validation: default").checker).toBe("tokens");
  expect(withFlags("validation: default space_change_sensitive").checker).toBe("exact");
  const float = withFlags("validator_flags: float_tolerance 1e-6");
  expect(float.checker).toBe("float");
  expect(float.tolerance).toBe(1e-6);
});

test("a custom checker needs exactly one file; interactive is refused", () => {
  const custom = readPackage(
    zip({
      ...basic,
      "problem.yaml": "name: X\nvalidation: custom\n",
      "output_validators/check/check.cpp": "int main() { return 42; }",
    }),
  );
  expect(custom.checker).toBe("custom");
  expect(custom.validator?.language).toBe("cpp");
  expect(() =>
    readPackage(zip({ ...basic, "problem.yaml": "name: X\nvalidation: custom\n" })),
  ).toThrow(PackageError);
  expect(() =>
    readPackage(
      zip({
        ...basic,
        "problem.yaml": "name: X\nvalidation: custom\n",
        "output_validators/c/a.cpp": "x",
        "output_validators/c/b.cpp": "y",
      }),
    ),
  ).toThrow(/more than one file/);
  expect(() =>
    readPackage(zip({ ...basic, "problem.yaml": "name: X\nvalidation: custom interactive\n" })),
  ).toThrow(/Interactive/);
});

test("groups come from folders and testdata.yaml", () => {
  const read = readPackage(
    zip({
      "problem.yaml": "name: Groups",
      "data/sample/1.in": "1",
      "data/sample/1.ans": "1",
      "data/secret/g1/testdata.yaml":
        "scoring:\n  score: 30\n  aggregation: min\non_reject: break\n",
      "data/secret/g1/a.in": "1",
      "data/secret/g1/a.ans": "1",
      "data/secret/g1/b.in": "2",
      "data/secret/g1/b.ans": "2",
      "data/secret/g2/testdata.yaml": "scoring:\n  score: 70\n",
      "data/secret/g2/a.in": "3",
      "data/secret/g2/a.ans": "3",
      "data/secret/g2/b.in": "4",
      "data/secret/g2/b.ans": "4",
    }),
  );
  expect(read.groups).toEqual({
    g1: { aggregation: "min", stopOnFail: true },
    g2: { aggregation: "sum", stopOnFail: false },
  });
  const points = (group: string) =>
    read.tests.filter((each) => each.groupKey === group).map((each) => each.points);
  expect(points("g1")).toEqual([30, 30]);
  expect(points("g2")).toEqual([35, 35]);
  expect(read.points).toBe(100);
});

test("a PDF-only statement is attached with a placeholder", () => {
  const files: Zippable = {
    "problem.yaml": strToU8("name: P"),
    "data/secret/a.in": strToU8("1"),
    "data/secret/a.ans": strToU8("1"),
    "statement/problem.en.pdf": new Uint8Array([37, 80, 68, 70]),
  };
  const read = readPackage(zipSync(files));
  expect(read.attachments[0]?.name).toBe("problem.en.pdf");
  expect(read.statementMd).toMatch(/problem\.en\.pdf/);
  expect(read.warnings.some((warning) => /PDF/.test(warning))).toBeTruthy();
});

test("attachments and jury solutions are collected", () => {
  const read = readPackage(
    zip({
      ...basic,
      "attachments/data set.txt": "x",
      "submissions/accepted/ok.py": "print(1)",
      "submissions/wrong_answer/bad.cpp": "int main(){}",
      "submissions/time_limit_exceeded/slow.java": "class Main{}",
      "submissions/accepted/notes.txt": "skip me",
    }),
  );
  expect(read.attachments.map((file) => file.name)).toEqual(["data set.txt"]);
  expect(read.solutions.map((each) => [each.language, each.expected])).toEqual([
    ["python", "AC"],
    ["java", "TLE"],
    ["cpp", "WA"],
  ]);
  expect(read.warnings.some((warning) => /skipped/.test(warning))).toBeTruthy();
});

test("jury solutions are capped at thirty", () => {
  const files: Record<string, string> = { ...basic };
  for (let n = 0; n < 35; n++) files[`submissions/accepted/s${n}.py`] = "pass";
  const read = readPackage(zip(files));
  expect(read.solutions.length).toBe(30);
});

test("limits outside what a problem allows are clamped with a warning", () => {
  const read = readPackage(
    zip({ ...basic, "problem.yaml": "name: X\nlimits:\n  time_limit: 600\n" }),
  );
  expect(read.timeLimitMs).toBe(60000);
  expect(read.warnings.some((warning) => /time limit/.test(warning))).toBeTruthy();
});

test("bad packages are refused", () => {
  expect(() => readPackage(strToU8("not a zip"))).toThrow(/readable ZIP/);
  expect(() => readPackage(zip({ "data/sample/1.in": "x" }))).toThrow(/problem\.yaml/);
  expect(() => readPackage(zip({ "problem.yaml": "name: X" }))).toThrow(/no test data/);
});

test("a package with too many files is refused", () => {
  const files: Record<string, string> = { "problem.yaml": "name: X" };
  for (let n = 0; n < 5001; n++) files[`data/secret/${n}.in`] = "";
  expect(() => readPackage(zip(files))).toThrow(/more than 5000/);
});

test("a file past the size limit is refused", () => {
  const big = zipSync({
    "problem.yaml": strToU8("name: X"),
    "data/secret/a.in": new Uint8Array(17 * 1024 * 1024),
    "data/secret/a.ans": strToU8("1"),
  });
  expect(() => readPackage(big)).toThrow(/larger than 16 MB/);
});

test("safeFileName fits the attachments table and avoids clashes", () => {
  expect(safeFileName("statement/a b?.png", new Set())).toBe("a b_.png");
  expect(safeFileName("x.txt", new Set(["x.txt"]))).toBe("x-2.txt");
  expect(safeFileName("../../.hidden", new Set())).toBe("_hidden");
});

test("languageForFile maps extensions", () => {
  expect(languageForFile("a.cc")).toBe("cpp");
  expect(languageForFile("A.PY")).toBe("python");
  expect(languageForFile("notes.txt")).toBe(null);
});

test("writing a package and reading it back keeps everything", () => {
  const problem: ProblemPackage = {
    name: "Round trip",
    timeLimitMs: 3000,
    memoryLimitMb: 128,
    outputLimitKb: 4096,
    checker: "float",
    tolerance: 0.001,
    validator: null,
    statementMd: "# Hi\n\nSolve it.",
    tests: [
      { isSample: true, groupKey: null, points: null, input: "1\n", answer: "2\n" },
      { isSample: false, groupKey: "easy", points: 20, input: "2\n", answer: "4\n" },
      { isSample: false, groupKey: "easy", points: 20, input: "3\n", answer: "6\n" },
      { isSample: false, groupKey: "hard", points: 60, input: "4\n", answer: "8\n" },
    ],
    groups: {
      easy: { aggregation: "sum", stopOnFail: false },
      hard: { aggregation: "min", stopOnFail: true },
    },
    attachments: [{ name: "data.txt", bytes: strToU8("hello") }],
    solutions: [{ label: "main", language: "python", source: "print(1)", expected: "AC" }],
  };
  const read = readPackage(writePackage(problem));
  expect(read.name).toBe(problem.name);
  expect(read.timeLimitMs).toBe(3000);
  expect(read.memoryLimitMb).toBe(128);
  expect(read.outputLimitKb).toBe(4096);
  expect(read.checker).toBe("float");
  expect(read.tolerance).toBe(0.001);
  expect(read.statementMd).toBe(problem.statementMd);
  expect(read.groups).toEqual(problem.groups);
  expect(
    read.tests.map((each) => [each.isSample, each.groupKey, each.points, each.input, each.answer]),
  ).toEqual(
    problem.tests.map((each) => [
      each.isSample,
      each.groupKey,
      each.points,
      each.input,
      each.answer,
    ]),
  );
  expect(read.attachments.map((file) => file.name)).toEqual(["data.txt"]);
  expect(read.solutions.map((each) => [each.language, each.expected, each.source])).toEqual([
    ["python", "AC", "print(1)"],
  ]);
});

test("a custom checker survives a round trip", () => {
  const read = readPackage(
    writePackage({
      name: "Custom",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 1024,
      checker: "custom",
      tolerance: null,
      validator: { language: "cpp", filename: "check.cpp", source: "int main(){return 42;}" },
      statementMd: "",
      tests: [{ isSample: false, groupKey: null, points: null, input: "1", answer: "1" }],
      groups: {},
      attachments: [],
      solutions: [],
    }),
  );
  expect(read.checker).toBe("custom");
  expect(read.validator?.source).toBe("int main(){return 42;}");
});
