import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../..", import.meta.url));

// Paths the docs name that don't exist in a fresh checkout, on purpose.
const ABSENT_BY_DESIGN: Record<string, string> = {
  "supabase/RELEASED": "written by `bogey db freeze`",
};

const PATH = /`((?:apps|packages|tools|supabase|docs|\.agents)\/[^`\s]+)`/g;

function agentDocs(): string[] {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  }).split("\n");
  return listed.filter(
    (path) =>
      path === "CONTEXT.md" ||
      /^\.agents\/skills\/bogey-[^/]+\/SKILL\.md$/.test(path) ||
      (/(^|\/)AGENTS\.md$/.test(path) && !path.startsWith(".agents/")),
  );
}

// Placeholders (`<key>`, `**`, `{a,b}`) stand for many paths; check the part before them.
function checkablePrefix(path: string): string {
  const cut = path.search(/[<*{]/);
  const fixed = cut === -1 ? path : path.slice(0, path.lastIndexOf("/", cut) + 1);
  return fixed.replace(/[.,:;)]+$/, "");
}

test("every repo path the agent docs name exists", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const doc of agentDocs()) {
    for (const match of readFileSync(join(root, doc), "utf8").matchAll(PATH)) {
      const path = checkablePrefix(match[1] ?? "");
      if (!path || path in ABSENT_BY_DESIGN) continue;
      if (path.startsWith("packages/plugins/installed/")) continue;
      checked++;
      if (!existsSync(join(root, path.split("#")[0] ?? path))) missing.push(`${doc}: ${path}`);
    }
  }
  expect(checked).toBeGreaterThan(50);
  expect(missing).toEqual([]);
});
