import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { ioiScore, judgingVerdict, stopsGroup, testPoints } from "../src/scoring.ts";
import type { Problem, Testcase } from "../src/types.ts";

const problem = (extra: Partial<Problem> = {}): Problem => ({
  id: "p",
  label: "A",
  time_limit_ms: 1000,
  memory_limit_mb: 256,
  output_limit_kb: 64,
  checker: "tokens",
  checker_tolerance: null,
  checker_source: null,
  checker_language: null,
  points: 100,
  test_groups: {},
  ...extra,
});

const test_ = (id: string, extra: Partial<Testcase> = {}): Testcase => ({
  id,
  ordinal: 1,
  is_sample: false,
  group_key: null,
  points: null,
  ...extra,
});

const passed = (...ids: string[]) => ids.map((id) => ({ testcase_id: id, verdict: "AC" as const }));

test("the first failure names the verdict", () => {
  assert.equal(judgingVerdict([{ verdict: "AC" }, { verdict: "TLE" }, { verdict: "WA" }]), "TLE");
  assert.equal(judgingVerdict([{ verdict: "AC" }]), "AC");
  assert.equal(judgingVerdict([]), "AC");
});

test("tests share what the problem is worth, and samples are worth nothing", () => {
  const tests = [test_("s", { is_sample: true }), test_("a"), test_("b"), test_("c"), test_("d")];
  const points = testPoints(problem(), tests);
  assert.equal(points.get("s"), 0);
  assert.equal(points.get("a"), 25);
});

test("tests with their own points keep them and the rest share what is left", () => {
  const tests = [test_("a", { points: 60 }), test_("b"), test_("c")];
  const points = testPoints(problem(), tests);
  assert.equal(points.get("a"), 60);
  assert.equal(points.get("b"), 20);
});

test("ungrouped tests each score their points", () => {
  const tests = [test_("a"), test_("b"), test_("c"), test_("d")];
  assert.equal(ioiScore(problem(), tests, passed("a", "c")), 50);
  assert.equal(ioiScore(problem(), tests, passed("a", "b", "c", "d")), 100);
  assert.equal(ioiScore(problem(), tests, []), 0);
});

test("a min group is all or nothing, worth its largest test", () => {
  const tests = [
    test_("a", { group_key: "g1", points: 40 }),
    test_("b", { group_key: "g1", points: 40 }),
    test_("c", { group_key: "g2", points: 60 }),
  ];
  const rules = problem({ test_groups: { g1: { aggregation: "min", stopOnFail: false } } });
  assert.equal(ioiScore(rules, tests, passed("a", "c")), 60, "g1 missed b, so only g2 counts");
  assert.equal(ioiScore(rules, tests, passed("a", "b", "c")), 100);
});

test("a sum group scores the tests it passed", () => {
  const tests = [
    test_("a", { group_key: "g", points: 30 }),
    test_("b", { group_key: "g", points: 70 }),
  ];
  assert.equal(ioiScore(problem(), tests, passed("b")), 70);
});

test("a custom checker's partial score counts in a sum group, up to the test's points", () => {
  const tests = [test_("a", { points: 50 }), test_("b", { points: 50 })];
  const partial = new Map([
    ["a", 20],
    ["b", 500],
  ]);
  assert.equal(ioiScore(problem(), tests, [], partial), 70);
  const minRules = problem({ test_groups: { g: { aggregation: "min", stopOnFail: false } } });
  const grouped = [test_("a", { group_key: "g", points: 50 })];
  assert.equal(
    ioiScore(minRules, grouped, [], new Map([["a", 20]])),
    0,
    "min groups give no partial credit",
  );
});

test("stopOnFail comes from the test's group", () => {
  const rules = problem({ test_groups: { g: { aggregation: "sum", stopOnFail: true } } });
  assert.equal(stopsGroup(rules, test_("a", { group_key: "g" })), true);
  assert.equal(stopsGroup(rules, test_("a", { group_key: "h" })), false);
  assert.equal(stopsGroup(rules, test_("a")), false);
});
