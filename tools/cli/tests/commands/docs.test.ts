import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  cliReference,
  pageName,
  runDocs,
  settingsReference,
  wikiLinks,
} from "../../src/commands/docs.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

test("the committed references match the registry and commands", async () => {
  expect((await runDocs(cliDir, ["--check"])).output).toBe("Generated docs are up to date.");
});

test("the CLI reference covers every command", async () => {
  const { COMMANDS } = await import("../../src/commands.ts");
  expect(cliReference(COMMANDS)).toContain("## backup");
  expect(cliReference(COMMANDS)).toContain("bogey org domain add");
});

test("wiki page names flatten paths", () => {
  expect(pageName("self-hosting/deploy.md")).toBe("self-hosting-deploy");
  expect(pageName("adr/README.md")).toBe("adr");
  expect(pageName("Home.md")).toBe("Home");
  expect(pageName("meta/_Sidebar.md")).toBe("_Sidebar");
});

test("wiki links point at pages, and at GitHub for other repo files", () => {
  const root = fileURLToPath(new URL("../../../..", import.meta.url));
  const out = wikiLinks(
    "[a](deploy.md#backups) [b](../contributing.md) [c](../../supabase/config.toml) [d](https://x.test) [e](#here)",
    "self-hosting/network.md",
    "someone/bogey",
    root,
  );
  expect(out).toBe(
    "[a](self-hosting-deploy#backups) [b](contributing) [c](https://github.com/someone/bogey/blob/main/supabase/config.toml) [d](https://x.test) [e](#here)",
  );
});

test("every namespace gets a section with its scopes", () => {
  const reference = settingsReference();
  expect(reference).toContain("## Network access (`access`)");
  expect(reference).toContain("Set at: instance.");
});

test("every relative link in docs/ points at a file that exists", () => {
  const root = fileURLToPath(new URL("../../../..", import.meta.url));
  const docs = join(root, "docs");
  const files = (function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : name.endsWith(".md") ? [path] : [];
    });
  })(docs);
  const broken: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf-8").replace(/```[\s\S]*?```/g, "");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!target || /^([a-z]+:|#)/i.test(target)) continue;
      const path = target.split("#")[0] ?? "";
      if (!existsSync(join(dirname(file), path)))
        broken.push(`${file.slice(root.length)} → ${target}`);
    }
  }
  expect(broken).toEqual([]);
});

test("meta pages link to docs one folder up", () => {
  expect(
    wikiLinks(
      "[Home](../Home.md) [Auth](../self-hosting/auth.md)",
      "meta/_Sidebar.md",
      "someone/bogey",
      "/nowhere",
    ),
  ).toBe("[Home](Home) [Auth](self-hosting-auth)");
});
