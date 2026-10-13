import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import {
  invalid,
  isPlaceholder,
  parseExample,
  renderEnv,
  runSetup,
} from "../../src/commands/setup.ts";
import { scripted } from "../support/prompter.ts";
import type { Runner } from "../../src/lib/migrations.ts";

const EXAMPLE = `# Supabase.
SUPABASE_URL=http://localhost:8000
SUPABASE_PUBLISHABLE_KEY=your-anon-or-publishable-key

# Server-only.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Email.
SMTP_PORT=587
SEND_EMAIL_HOOK_SECRET=v1,whsec_replace-with-a-random-base64-secret
`;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-setup-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, ".env.example"), EXAMPLE);
});

test("parseExample keeps each key's comment", () => {
  const entries = parseExample(EXAMPLE);
  expect(entries.map((entry) => entry.key)).toEqual([
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SMTP_PORT",
    "SEND_EMAIL_HOOK_SECRET",
  ]);
  expect(entries[0]?.help).toEqual(["Supabase."]);
  expect(entries[1]?.help).toEqual([]);
});

test("validation", () => {
  expect(invalid("SUPABASE_URL", "localhost")).toMatch(/URL/);
  expect(invalid("SUPABASE_URL", "")).toBe("Required.");
  expect(invalid("SMTP_PORT", "abc")).toMatch(/port/);
  expect(invalid("SUPABASE_PUBLISHABLE_KEY", "sb_secret_x")).toMatch(/secret key/);
  expect(invalid("SMTP_HOST", "")).toBeNull();
  expect(isPlaceholder("your-service-role-key")).toBe(true);
});

test("renderEnv follows the example's order and keeps extra keys", () => {
  const out = renderEnv(
    parseExample(EXAMPLE),
    new Map([
      ["SUPABASE_URL", "http://x"],
      ["EXTRA", "1"],
    ]),
  );
  expect(out).toContain("# Supabase.\nSUPABASE_URL=http://x");
  expect(out).toContain("# Not in .env.example\nEXTRA=1");
});

test("asks for each value, generates the hook secret and skips org init", async () => {
  const { prompter } = scripted(["", "sb_publishable_abc", "sb_secret_abc", "", "", false]);
  const result = await runSetup(root, [], prompter);
  expect(result.exitCode).toBe(0);
  const env = readFileSync(join(root, ".env"), "utf-8");
  expect(env).toContain("SUPABASE_URL=http://localhost:8000");
  expect(env).toContain("SUPABASE_SERVICE_ROLE_KEY=sb_secret_abc");
  expect(env).toMatch(/SEND_EMAIL_HOOK_SECRET=v1,whsec_[A-Za-z0-9+/=]{40,}/);
});

test("applies the schema when DATABASE_URL is set and the person agrees", async () => {
  writeFileSync(join(root, ".env.example"), `${EXAMPLE}DATABASE_URL=postgres://u:p@h/db\n`);
  const calls: string[][] = [];
  const run: Runner = (command, args) => {
    calls.push([command, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };
  const { prompter, asked } = scripted([
    "",
    "sb_publishable_abc",
    "sb_secret_abc",
    "",
    "",
    "postgres://u:p@h/db",
    true,
    false,
  ]);
  const result = await runSetup(root, [], prompter, {}, run);
  expect(result.exitCode).toBe(0);
  expect(calls.length).toBeGreaterThan(0);
  expect(asked).toContain("Apply the database schema now?");
  expect(asked).toContain("Create the first organization now?");
});

test("--from-env refuses to write without the required values", async () => {
  const result = await runSetup(root, ["--from-env"], null, { SUPABASE_URL: "http://x" });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("SUPABASE_PUBLISHABLE_KEY: Required.");
});
