import { expect, test } from "vite-plus/test";
import { present, reportable } from "../../src/lib/present.ts";
import { offerReport } from "../../src/lib/report.ts";
import { ISSUES_URL } from "../../src/lib/repository.ts";
import { scripted } from "../support/prompter.ts";

const tests =
  "✗ vp run -r test\n    ✓ tests/certificate.test.ts\n    × a test failed\n    \n    ---";

test("another program's output gets no hints, but still ends in the failure banner", () => {
  const result = { exitCode: 1, output: tests, hints: false };
  const text = present(result, "bogey", [], "release");
  expect(text).not.toContain("hint:");
  expect(text).toContain("bogey release failed.");
  expect(reportable(result, "release")).toBe(true);
  expect(reportable({ exitCode: 1, output: "short" }, "release")).toBe(false);
});

test("a failure offers to copy the error, then to open the issues page", async () => {
  const { prompter, asked, said } = scripted([true, true]);
  const copied: string[] = [];
  const opened: string[] = [];
  await offerReport(prompter, "\x1b[31m✗ boom\x1b[39m", {
    copy: (text) => copied.push(text) > 0,
    open: (url) => opened.push(url),
  });
  expect(asked).toEqual(["Copy the error?", `Open ${ISSUES_URL}?`]);
  expect(copied).toEqual(["✗ boom"]);
  expect(said).toEqual(["Copied."]);
  expect(opened).toEqual([ISSUES_URL]);
});

test("declining both copies and opens nothing", async () => {
  const { prompter } = scripted([false, false]);
  const used: string[] = [];
  await offerReport(prompter, "✗ boom", {
    copy: (text) => used.push(text) > 0,
    open: (url) => used.push(url),
  });
  expect(used).toEqual([]);
});
