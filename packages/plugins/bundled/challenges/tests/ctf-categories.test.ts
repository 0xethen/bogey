import { expect, test } from "vite-plus/test";
import { flagMessage, groupByCategory, isFlagResult } from "../ctf/categories.ts";

test("challenges group by category in alphabetical order", () => {
  const groups = groupByCategory([
    { category: "web", id: 1 },
    { category: "crypto", id: 2 },
    { category: "web", id: 3 },
  ]);
  expect(groups.map((group) => [group.category, group.challenges.map((c) => c.id)])).toEqual([
    ["crypto", [2]],
    ["web", [1, 3]],
  ]);
});

test("only the three results the database returns are recognized", () => {
  expect(isFlagResult("correct")).toBe(true);
  expect(isFlagResult("nope")).toBe(false);
  expect(flagMessage("solved")).toBe("Your team already solved this.");
});
