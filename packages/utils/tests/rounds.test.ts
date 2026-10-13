import { expect, test } from "vite-plus/test";
import { activeRound, type RoundInfo } from "../src/rounds.ts";

const rounds: RoundInfo[] = [
  { id: "r1", formId: "f", ordinal: 1, name: "Round 1" },
  { id: "r2", formId: "f", ordinal: 2, name: "Round 2" },
  { id: "r3", formId: "f", ordinal: 3, name: "Final" },
  { id: "o1", formId: "other", ordinal: 1, name: "Round 1" },
];

test("everyone is in round 1", () => {
  expect(activeRound(rounds, [], { id: "s", formId: "f" })?.id).toBe("r1");
});

test("an advanced entry is judged in the latest round it reached", () => {
  const entries = [
    { roundId: "r2", submissionId: "s" },
    { roundId: "r3", submissionId: "t" },
  ];
  expect(activeRound(rounds, entries, { id: "s", formId: "f" })?.id).toBe("r2");
  expect(activeRound(rounds, entries, { id: "t", formId: "f" })?.id).toBe("r3");
  expect(activeRound(rounds, entries, { id: "u", formId: "f" })?.id).toBe("r1");
});

test("rounds of other forms don't count", () => {
  expect(activeRound(rounds, [], { id: "s", formId: "other" })?.id).toBe("o1");
  expect(activeRound(rounds, [], { id: "s", formId: "none" })).toBeUndefined();
});
