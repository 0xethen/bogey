import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readThemes, themesCss, themesModule } from "../../src/commands/themes.ts";
import { runWatch } from "../../src/commands/watch.ts";

function themeDir(files: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), "bogey-themes-")), "themes");
  mkdirSync(dir);
  for (const [name, css] of Object.entries(files)) writeFileSync(join(dir, name), css);
  return dir;
}

test("reads themes with labels, default first", () => {
  const dir = themeDir({
    "ocean.theme.css": '/* @theme Ocean */\n:root[data-theme="ocean"] {}',
    "default.theme.css": "/* @theme Bogey */\n:root {}",
    "notes.css": "",
  });
  const { themes, problems } = readThemes(dir);
  expect(problems).toEqual([]);
  expect(themes).toEqual([
    { key: "default", label: "Bogey" },
    { key: "ocean", label: "Ocean" },
  ]);
  expect(themesCss(themes)).toContain('@import "themes/ocean.theme.css";');
  expect(themesModule(themes)).toContain('{ key: "ocean", label: "Ocean" }');
});

test("rescopes a theme that styles the wrong selector", () => {
  const dir = themeDir({ "default.theme.css": ":root {}", "ocean.theme.css": ":root {}" });
  expect(readThemes(dir).problems).toEqual([]);
  expect(readFileSync(join(dir, "ocean.theme.css"), "utf-8")).toContain(
    ':root[data-theme="ocean"] {',
  );
});

test("flags a theme with nothing to scope", () => {
  const dir = themeDir({ "default.theme.css": ":root {}", "ocean.theme.css": ".x {}" });
  expect(readThemes(dir).problems).toEqual([
    'ocean.theme.css has no :root block to scope to :root[data-theme="ocean"]',
  ]);
});

test("watch rejects unknown flags", async () => {
  const result = await runWatch(process.cwd(), ["--nope"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("--themes");
});
