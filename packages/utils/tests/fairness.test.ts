import { expect, test } from "vite-plus/test";
import { calibrationFlags, parseConflicts } from "../src/fairness.ts";

test("reads conflicts with or without a header", () => {
  const withHeader = parseConflicts(
    "judge email,team,reason\nada@x.org,Rockets,Her daughter's team\n",
  );
  expect(withHeader.lines).toEqual([
    { email: "ada@x.org", team: "Rockets", reason: "Her daughter's team" },
  ]);
  const bare = parseConflicts("ada@x.org\tRockets\nbob@x.org\tComets");
  expect(bare.lines.map((line) => line.team)).toEqual(["Rockets", "Comets"]);
});

test("says which lines it can't read", () => {
  const result = parseConflicts("ada@x.org,Rockets\nnot an email,Comets\nbob@x.org,\n");
  expect(result.lines).toHaveLength(1);
  expect(result.problems.map((problem) => problem.line)).toEqual([2, 3]);
});

const judge = (judgeId: string, meanPct: number, sdPct = 20, scores = 20) => ({
  judgeId,
  meanPct,
  sdPct,
  scores,
});

test("flags a judge far below or above the others", () => {
  const flags = calibrationFlags([
    judge("a", 70),
    judge("b", 72),
    judge("c", 68),
    judge("d", 71),
    judge("e", 69),
    judge("harsh", 25),
    judge("generous", 98),
  ]);
  expect(flags.get("harsh")).toBe("harsh");
  expect(flags.get("a")).toBeNull();
});

test("flags a judge who gives everything the same mark", () => {
  const flags = calibrationFlags([judge("a", 60), judge("flat", 62, 2, 30)]);
  expect(flags.get("flat")).toBe("flat");
  expect(flags.get("a")).toBeNull();
});

test("needs three judges to call anyone harsh or generous", () => {
  const flags = calibrationFlags([judge("a", 20), judge("b", 90)]);
  expect([...flags.values()]).toEqual([null, null]);
});
