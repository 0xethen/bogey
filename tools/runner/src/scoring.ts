import type { GroupRule, Problem, Run, Testcase, Verdict } from "./types.ts";

export function firstFailure(runs: Tuple<{ verdict: Verdict }>): Verdict | null {
  return runs.find((run) => run.verdict !== "AC")?.verdict ?? null;
}

interface Group {
  key: string;
  tests: Testcase[];
  rule: GroupRule;
}

const DEFAULT_RULE: GroupRule = { aggregation: "sum", stopOnFail: false };

export function testPoints(
  problem: Pick<Problem, "points">,
  tests: Tuple<Testcase>,
): Map<string, number> {
  const scored = tests.filter((test) => !test.is_sample || test.points !== null);
  const fixed = scored.reduce((sum, test) => sum + (test.points ?? 0), 0);
  const unset = scored.filter((test) => test.points === null);
  const share = unset.length > 0 ? Math.max(problem.points - fixed, 0) / unset.length : 0;
  return new Map(tests.map((test) => [test.id, test.points ?? (test.is_sample ? 0 : share)]));
}

export function groupTests(problem: Problem, tests: Tuple<Testcase>): Group[] {
  const groups = new Map<string, Group>();
  for (const test of tests) {
    const key = test.group_key ?? `#${test.id}`;
    const group = groups.get(key) ?? {
      key,
      tests: [],
      rule: (test.group_key !== null && problem.test_groups[test.group_key]) || DEFAULT_RULE,
    };
    group.tests.push(test);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function stopsGroup(problem: Problem, test: Testcase): boolean {
  return test.group_key !== null && problem.test_groups[test.group_key]?.stopOnFail === true;
}

export function ioiScore(
  problem: Problem,
  tests: Tuple<Testcase>,
  runs: Tuple<Pick<Run, "testcase_id" | "verdict">>,
  partial: ReadonlyMap<string, number> = new Map(),
): number {
  const points = testPoints(problem, tests);
  const passed = new Set(runs.filter((run) => run.verdict === "AC").map((run) => run.testcase_id));
  let total = 0;
  for (const group of groupTests(problem, tests)) {
    if (group.rule.aggregation === "min") {
      if (group.tests.every((test) => passed.has(test.id))) {
        total += Math.max(...group.tests.map((test) => points.get(test.id) ?? 0));
      }
    } else {
      total += group.tests.reduce((sum, test) => {
        const worth = points.get(test.id) ?? 0;
        return sum + (passed.has(test.id) ? worth : Math.min(partial.get(test.id) ?? 0, worth));
      }, 0);
    }
  }
  return Math.round(total * 100) / 100;
}

export function judgingVerdict(runs: Tuple<{ verdict: Verdict }>): Verdict {
  return firstFailure(runs) ?? "AC";
}
