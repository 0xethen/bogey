import { expect, test } from "vite-plus/test";
import { solveTime } from "../contest/times.ts";

test("a solve's time is in minutes, or minutes and seconds when the contest counts seconds", () => {
  expect(solveTime({ minutes: 47, seconds: 2825 }, "minutes")).toBe("47m");
  expect(solveTime({ minutes: 47, seconds: 2825 }, "seconds")).toBe("47:05");
  expect(solveTime({ minutes: 47 }, "seconds")).toBe("47m");
  expect(solveTime({ minutes: null, seconds: null }, "seconds")).toBeNull();
});
