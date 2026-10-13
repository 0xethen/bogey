import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { runBackup } from "../../src/commands/backup.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));
const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PATH"] as const;
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

test("--help explains restoring", async () => {
  const result = await runBackup(cliDir, ["--help"]);
  expect(result.output).toContain("To restore");
});

test("a missing pg_dump is named, not a stack trace", async () => {
  process.env.PATH = "";
  const out = join(mkdtempSync(join(tmpdir(), "bogey-backup-")), "out");
  const result = await runBackup(cliDir, ["--db-url", "postgres://x", "--out", out]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("pg_dump isn't installed");
});
