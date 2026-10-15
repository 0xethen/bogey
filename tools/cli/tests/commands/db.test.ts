import { expect, test } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { runDb } from "../../src/commands/db.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

test("no subcommand prints usage and exits 0", () => {
  const result = runDb(cliDir, []);

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("bogey db <subcommand>");
});

test("an unknown subcommand exits 1", () => {
  const result = runDb(cliDir, ["not-a-real-subcommand"]);

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("not-a-real-subcommand");
});

test("url prints ports read from this repo's supabase/config.toml", () => {
  const result = runDb(cliDir, ["url"]);

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("http://127.0.0.1:54321");
  expect(result.output).toContain("http://127.0.0.1:54323");
});

test("studio opens the Studio URL rather than spawning a real browser", () => {
  const opened: string[] = [];

  const result = runDb(cliDir, ["studio"], (url) => opened.push(url));

  expect(result.exitCode).toBe(0);
  expect(opened).toEqual(["http://127.0.0.1:54323"]);
  expect(result.output).toContain("http://127.0.0.1:54323");
});

test("the committed baseline and generated schema files are current", () => {
  const result = runDb(cliDir, ["baseline", "--check"]);

  expect(result.output).toMatch(/up to date/);
  expect(result.exitCode).toBe(0);
});
