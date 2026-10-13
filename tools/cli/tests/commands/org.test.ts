import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { runOrg } from "../../src/commands/org.ts";

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

test("no subcommand prints usage", async () => {
  const result = await runOrg(cliDir, []);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("bogey org domain add");
});

test("an unknown subcommand is refused", async () => {
  const result = await runOrg(cliDir, ["delete"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain('unknown subcommand "delete"');
});

test("create needs a slug, name and owner", async () => {
  const result = await runOrg(cliDir, ["create", "--org", "acme"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("--owner");
});

test("a malformed hostname is refused before any request", async () => {
  const created = await runOrg(cliDir, [
    "create",
    "--org",
    "acme",
    "--name",
    "Acme",
    "--owner",
    "a@b.test",
    "--host",
    "not a host",
  ]);
  expect(created.output).toBe('"not a host" isn\'t a hostname');
  const added = await runOrg(cliDir, ["domain", "add", "acme", "bad/host"]);
  expect(added.exitCode).toBe(1);
});
