import { describe, expect, test } from "vite-plus/test";
import { userTrace } from "../preview-runner.ts";

describe("userTrace", () => {
  test("keeps only the participant's Python frames", () => {
    const full = [
      "Traceback (most recent call last):",
      '  File "/lib/python313.zip/_pyodide/_base.py", line 597, in eval_code_async',
      "    await CodeRunner(",
      '  File "<exec>", line 4, in <module>',
      '  File "<main>", line 3, in <module>',
      "    print(1 / 0)",
      "ZeroDivisionError: division by zero",
    ].join("\n");
    expect(userTrace(full, "python")).toBe(
      [
        "Traceback (most recent call last):",
        '  File "<main>", line 3, in <module>',
        "    print(1 / 0)",
        "ZeroDivisionError: division by zero",
      ].join("\n"),
    );
  });

  test("keeps a Python syntax error's location", () => {
    const full = [
      "Traceback (most recent call last):",
      '  File "<exec>", line 4, in <module>',
      '  File "<main>", line 1',
      "    print(",
      "         ^",
      "SyntaxError: '(' was never closed",
    ].join("\n");
    expect(userTrace(full, "python")).toBe(
      [
        "Traceback (most recent call last):",
        '  File "<main>", line 1',
        "    print(",
        "         ^",
        "SyntaxError: '(' was never closed",
      ].join("\n"),
    );
  });

  test("maps JavaScript frames to the participant's lines and drops the runner's", () => {
    const full = [
      "ReferenceError: x is not defined",
      "    at eval (eval at runJavaScript (blob:null/abc:158:25), <anonymous>:5:13)",
      "    at runJavaScript (blob:null/abc:163:15)",
    ].join("\n");
    expect(userTrace(full, "javascript")).toBe(
      ["ReferenceError: x is not defined", "    at line 2, column 13"].join("\n"),
    );
  });

  test("leaves other output alone", () => {
    expect(userTrace("just a warning", "python")).toBe("just a warning");
  });
});
