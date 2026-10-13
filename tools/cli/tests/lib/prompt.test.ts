import { expect, test } from "vite-plus/test";
import { groupJump } from "../../src/lib/prompt.ts";

const options = [
  { group: "A" },
  { group: "A" },
  { group: "A" },
  { group: "B" },
  { group: "B" },
  { group: "C" },
];

test("Shift+Down goes to the first option of the next group, then wraps", () => {
  expect(groupJump(options, 0, "down")).toBe(3);
  expect(groupJump(options, 4, "down")).toBe(5);
  expect(groupJump(options, 5, "down")).toBe(0);
});

test("Shift+Up goes to the start of this group, then the previous one, then wraps", () => {
  expect(groupJump(options, 2, "up")).toBe(0);
  expect(groupJump(options, 3, "up")).toBe(0);
  expect(groupJump(options, 5, "up")).toBe(3);
  expect(groupJump(options, 0, "up")).toBe(5);
});

test("without groups there is nowhere to jump but the ends", () => {
  const plain = [{}, {}, {}];
  expect(groupJump(plain, 1, "down")).toBe(0);
  expect(groupJump(plain, 1, "up")).toBe(0);
});
