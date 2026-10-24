import { expect, test } from "vite-plus/test";
import {
  FRESH_IMPORT,
  importChoices,
  type ImportChoicesAction,
} from "../src/routes/_authed/events/$slug/manage/-components/import-choices.ts";

const run = (...actions: ImportChoicesAction[]) => actions.reduce(importChoices, FRESH_IMPORT);

test("an import starts with max guessing", () => {
  expect(FRESH_IMPORT).toEqual({ guess: "max", started: false });
});

test("the level can be picked before the import starts", () => {
  expect(run({ type: "pick", guess: "none" }, { type: "start" })).toEqual({
    guess: "none",
    started: true,
  });
});

test("the level is locked once the import has started", () => {
  const started = run({ type: "pick", guess: "some" }, { type: "start" });
  expect(importChoices(started, { type: "pick", guess: "none" })).toBe(started);
  expect(importChoices(started, { type: "start" })).toBe(started);
});

test("starting over unlocks the level and keeps the last pick", () => {
  const over = run(
    { type: "pick", guess: "some" },
    { type: "start" },
    { type: "pick", guess: "none" },
    { type: "startOver" },
  );
  expect(over).toEqual({ guess: "some", started: false });
  expect(importChoices(over, { type: "pick", guess: "none" }).guess).toBe("none");
});
