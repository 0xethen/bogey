import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { runEvent } from "../../src/commands/event.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));
const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_testing";
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("with no subcommand it prints usage", async () => {
  const result = await runEvent(cliDir, []);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("bogey event export");
});

test("export needs an org/event name and a folder", async () => {
  const result = await runEvent(cliDir, ["export", "just-one-word"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("<org>/<event>");
});

test("import needs a folder that exists", async () => {
  const result = await runEvent(cliDir, ["import", "/definitely/not/here"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("folder");
});

test("import refuses a folder that isn't an archive", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bogey-archive-"));
  writeFileSync(join(folder, "readme.txt"), "hi");
  const result = await runEvent(cliDir, ["import", folder]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("manifest.json");
});
