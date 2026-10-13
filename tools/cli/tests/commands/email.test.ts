import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { FALLBACK_TEMPLATES, fallbackHtml, runEmail } from "../../src/commands/email.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

test("the committed fallback templates match the defaults", () => {
  expect(runEmail(cliDir, ["templates", "--check"]).exitCode).toBe(0);
});

test("a fallback template carries GoTrue's variables and nothing of Bogey's", () => {
  for (const template of FALLBACK_TEMPLATES) {
    const html = fallbackHtml(template);
    expect(html).toContain("{{ .Token }}");
    expect(html).not.toMatch(/\{\{\s*(code|link|org|platform|content|footer|brand)\s*\}\}/);
    if (template.kind !== "reauthentication") {
      expect(html).toContain(`token_hash={{ .TokenHash }}&amp;type=${template.type}`);
    }
  }
});

test("it only knows `templates`", () => {
  expect(runEmail(cliDir, []).exitCode).toBe(1);
  expect(runEmail(cliDir, ["templates", "--nope"]).exitCode).toBe(1);
});
