import { expect, test } from "vite-plus/test";
import { inputDisabled } from "../../src/lib/terminal.ts";

test("BOGEY_NO_INPUT turns asking off unless it's empty, 0 or false", () => {
  expect(inputDisabled({ BOGEY_NO_INPUT: "1" })).toBe(true);
  expect(inputDisabled({ BOGEY_NO_INPUT: "yes" })).toBe(true);
  expect(inputDisabled({})).toBe(false);
  expect(inputDisabled({ BOGEY_NO_INPUT: "" })).toBe(false);
  expect(inputDisabled({ BOGEY_NO_INPUT: "0" })).toBe(false);
  expect(inputDisabled({ BOGEY_NO_INPUT: "false" })).toBe(false);
});
