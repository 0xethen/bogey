import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  answerProblem,
  clearPluginAnswerValidators,
  cleanOptions,
  isCoreAnswerKind,
  isPluginAnswerKind,
  loadPluginAnswerValidator,
  MAX_PLUGIN_ANSWER_LENGTH,
  registerPluginAnswerValidator,
  setPluginAnswerValidatorLoader,
  type AnswerRules,
} from "../src/answers.ts";

const rules = (kind: AnswerRules["kind"], extra: Partial<AnswerRules> = {}): AnswerRules => ({
  kind,
  label: "Answer",
  required: false,
  ...extra,
});

describe("answerProblem", () => {
  test("blank is fine unless required", () => {
    expect(answerProblem(rules("text"), "")).toBeNull();
    expect(answerProblem(rules("text", { required: true }), "  ")).toMatch(/required/);
  });

  test("links need http(s)", () => {
    expect(answerProblem(rules("url"), "https://example.com")).toBeNull();
    expect(answerProblem(rules("video"), "javascript:alert(1)")).toMatch(/https/);
    expect(answerProblem(rules("url"), "example.com")).toMatch(/https/);
  });

  test("drive links must be Google Drive or Docs", () => {
    expect(answerProblem(rules("drive"), "https://docs.google.com/document/d/1")).toBeNull();
    expect(answerProblem(rules("drive"), "https://dropbox.com/x")).toMatch(/Google/);
  });

  test("choices come from the options", () => {
    const choice = rules("select", { options: ["A", "B"] });
    expect(answerProblem(choice, "A")).toBeNull();
    expect(answerProblem(choice, "C")).toMatch(/options/);
  });

  test("length limits, default and configured", () => {
    expect(answerProblem(rules("text"), "x".repeat(301))).toMatch(/300/);
    expect(answerProblem(rules("longtext", { maxLength: 10 }), "x".repeat(11))).toMatch(/10/);
  });

  test("required checkboxes must be checked", () => {
    expect(answerProblem(rules("boolean", { required: true }), false)).toMatch(/Check/);
    expect(answerProblem(rules("boolean", { required: true }), true)).toBeNull();
  });

  test("numbers", () => {
    expect(answerProblem(rules("number"), "42")).toBeNull();
    expect(answerProblem(rules("number"), "forty")).toMatch(/number/);
  });
});

test("cleanOptions trims and drops blanks", () => {
  expect(cleanOptions([" Red ", "", "  ", "Blue"])).toEqual(["Red", "Blue"]);
});

describe("plugin kinds", () => {
  afterEach(() => clearPluginAnswerValidators());

  test("kinds are core words or <plugin>.<kind>", () => {
    expect(isPluginAnswerKind("sketch.canvas")).toBe(true);
    expect(isPluginAnswerKind("sketch")).toBe(false);
    expect(isPluginAnswerKind("Sketch.canvas")).toBe(false);
    expect(isPluginAnswerKind("a.b.c")).toBe(false);
    expect(isCoreAnswerKind("markdown")).toBe(true);
    expect(isCoreAnswerKind("sketch.canvas")).toBe(false);
  });

  test("the plugin's validator decides, with the item's settings", () => {
    registerPluginAnswerValidator("sketch.canvas", (value, item) => {
      if (value === undefined || value === "") return item.required ? "Draw something" : null;
      return typeof item.config.maxStrokes === "number" &&
        String(value).length > item.config.maxStrokes
        ? "Too many strokes"
        : null;
    });
    const sketch = rules("sketch.canvas", { config: { maxStrokes: 5 } });
    expect(answerProblem(sketch, "")).toBeNull();
    expect(answerProblem({ ...sketch, required: true }, "")).toBe("Draw something");
    expect(answerProblem(sketch, "12345")).toBeNull();
    expect(answerProblem(sketch, "123456")).toBe("Too many strokes");
  });

  test("an answer that isn't text or a boolean is refused before the plugin sees it", () => {
    registerPluginAnswerValidator("sketch.canvas", () => null);
    expect(answerProblem(rules("sketch.canvas"), { strokes: [] })).toMatch(/wrong kind/);
    expect(answerProblem(rules("sketch.canvas"), "x".repeat(MAX_PLUGIN_ANSWER_LENGTH + 1))).toMatch(
      /characters/,
    );
  });

  test("without a validator (plugin not running) only emptiness is checked", () => {
    expect(answerProblem(rules("sketch.canvas"), "anything")).toBeNull();
    expect(answerProblem(rules("sketch.canvas", { required: true }), "")).toMatch(/required/);
  });

  test("a loader can bring a validator in before the check", async () => {
    setPluginAnswerValidatorLoader(async (kind) => {
      registerPluginAnswerValidator(kind, () => "always no");
    });
    await loadPluginAnswerValidator("sketch.canvas");
    expect(answerProblem(rules("sketch.canvas"), "x")).toBe("always no");
    setPluginAnswerValidatorLoader(undefined);
  });
});
