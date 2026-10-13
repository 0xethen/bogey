import { expect, test } from "vite-plus/test";
import { en } from "@bogey/config/messages";
import { createTranslator } from "@bogey/utils/messages";
import { bindingProblem, type Binding } from "../src/lib/shortcut-conflicts.ts";

const t = createTranslator(en, { locale: "en", overlay: {} });

const all: Binding[] = [
  { id: "core.save", name: "Save changes", keys: "Mod+S" },
  { id: "core.shortcuts", name: "Keyboard shortcuts", keys: "Mod+/" },
  { id: "core.copy", name: "Copy link", keys: "Mod+Shift+C" },
  { id: "core.off", name: "Switched off", keys: null },
];

test("a free combination is accepted", () => {
  expect(bindingProblem("Mod+J", "core.save", all, t)).toBeNull();
});

test("a combination another shortcut uses is refused, naming it", () => {
  expect(bindingProblem("Mod+/", "core.save", all, t)).toMatch(
    /Already used by "Keyboard shortcuts"/,
  );
});

test("a shortcut can keep its own keys, and spellings of the same keys count as the same", () => {
  expect(bindingProblem("Mod+S", "core.save", all, t)).toBeNull();
  expect(bindingProblem("Mod+Shift+C", "core.shortcuts", all, t)).toMatch(/Copy link/);
});

test("an off shortcut doesn't hold its old keys", () => {
  expect(bindingProblem("Mod+O", "core.save", all, t)).toBeNull();
});

test("keys the browser keeps are refused", () => {
  expect(bindingProblem("Mod+W", "core.save", all, t)).toMatch(/browser/);
});
