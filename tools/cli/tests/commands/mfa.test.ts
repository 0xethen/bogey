import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { runMfa } from "../../src/commands/mfa.ts";

let root: string;
const requests: Array<{ method: string; url: string; body: string | null }> = [];
let stored: Array<{ value: Record<string, unknown> }> = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-mfa-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(
    join(root, ".env"),
    "SUPABASE_URL=http://db.test\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_test\n",
  );
  requests.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({
      method: init?.method ?? "GET",
      url: String(url),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const reply = init?.method === "GET" || !init?.method ? stored : [];
    return new Response(JSON.stringify(reply), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

test("it's on unless the setting says otherwise", async () => {
  stored = [];
  expect((await runMfa(root, [])).output).toContain("(on)");
  stored = [{ value: { requireAdminMfa: false } }];
  expect((await runMfa(root, ["status"])).output).toContain("(off)");
});

test("off writes the setting, keeping what else is in it", async () => {
  stored = [{ value: { deletionRequests: false } }];
  const result = await runMfa(root, ["off"]);
  expect(result.exitCode).toBe(0);
  const write = requests.find((request) => request.method === "PATCH");
  expect(JSON.parse(write?.body ?? "{}")).toEqual({
    value: { deletionRequests: false, requireAdminMfa: false },
  });
});

test("with no row yet, it creates one", async () => {
  stored = [];
  await runMfa(root, ["off"]);
  const write = requests.find((request) => request.method === "POST");
  expect(JSON.parse(write?.body ?? "{}")).toEqual({
    scope: "instance",
    namespace: "accounts",
    value: { requireAdminMfa: false },
  });
});

test("turning it to what it already is does nothing", async () => {
  stored = [];
  expect((await runMfa(root, ["on"])).output).toBe("Already on.");
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});

test("anything else prints the usage", async () => {
  expect((await runMfa(root, ["maybe"])).exitCode).toBe(1);
});
