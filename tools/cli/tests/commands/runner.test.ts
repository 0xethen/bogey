import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { newRunnerKey, runRunner } from "../../src/commands/runner.ts";
import { checkRunnerCompose } from "../../src/lib/checks.ts";

let root: string;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
let reply: (url: string) => Response;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-runner-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(
    join(root, ".env"),
    "SUPABASE_URL=http://db.test\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_test\n",
  );
  requests.length = 0;
  reply = () => new Response("null", { status: 200 });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    });
    return reply(String(url));
  });
});

afterEach(() => vi.unstubAllGlobals());

test("a new key is long, random and sent to the database only as its hash", async () => {
  const result = await runRunner(root, ["add", "judge-1"]);
  expect(result.exitCode).toBe(0);
  const key = /BOGEY_RUNNER_KEY=(\S+)/.exec(result.output)?.[1] ?? "";
  expect(key).toMatch(/^bogey_runner_[A-Za-z0-9_-]{43}$/);
  const sent = requests[0];
  expect(sent?.url).toBe("http://db.test/rest/v1/rpc/challenges_runner_key_add");
  expect(sent?.body).toEqual({
    p_name: "judge-1",
    p_key_sha256: createHash("sha256").update(key).digest("hex"),
    p_replace: false,
  });
  expect(JSON.stringify(sent?.body)).not.toContain(key);
  expect(newRunnerKey().key).not.toBe(newRunnerKey().key);
});

test("a name that is taken says how to replace it", async () => {
  reply = () => new Response('{"message":"duplicate key value","code":"23505"}', { status: 409 });
  const result = await runRunner(root, ["add", "runner"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("--replace");
  await runRunner(root, ["add", "runner", "--replace"]);
  expect(requests.at(-1)?.body.p_replace).toBe(true);
});

test("names are checked before anything is sent", async () => {
  for (const name of ["", "Runner", "a b", "-x", "x".repeat(41)]) {
    expect((await runRunner(root, ["add", name])).exitCode).toBe(1);
  }
  expect(requests).toEqual([]);
});

test("keys are listed, with a warning when a runner still uses the service key", async () => {
  reply = (url) =>
    url.endsWith("challenges_runner_keys")
      ? Response.json([
          {
            name: "runner",
            created_at: "2026-10-20T10:00:00Z",
            last_used_at: null,
            revoked_at: null,
          },
        ])
      : Response.json(3);
  const result = await runRunner(root, ["keys"]);
  expect(result.output).toContain("runner");
  expect(result.output).toContain("last used never");
  expect(result.output).toContain("service key in the last 7 days");
});

test("revoking a key that doesn't work already fails", async () => {
  reply = () => Response.json(null);
  expect((await runRunner(root, ["revoke", "runner"])).exitCode).toBe(1);
  reply = () => Response.json(true);
  expect((await runRunner(root, ["revoke", "runner"])).output).toContain("no longer works");
});

test("a database without runner keys says to migrate", async () => {
  reply = () =>
    new Response('{"code":"PGRST202","message":"Could not find the function"}', { status: 404 });
  expect((await runRunner(root, ["keys"])).output).toContain("bogey plugins migrate");
});

test("doctor spots a runner compose file from before runner keys", () => {
  const old = `services:
  runner:
    image: x
    environment:
      SUPABASE_SERVICE_ROLE_KEY: \${SUPABASE_SERVICE_ROLE_KEY}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`;
  expect(checkRunnerCompose(old, "compose.runner.yml").map((issue) => issue.message)).toEqual([
    expect.stringContaining("service-role key"),
    expect.stringContaining("Docker socket"),
  ]);
  const current = readFileSync(
    new URL("../../../../deploy/all-in-one/compose.runner.yml", import.meta.url),
    "utf-8",
  );
  expect(checkRunnerCompose(current, "compose.runner.yml")).toEqual([]);
});
