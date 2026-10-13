import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { runLogin } from "../../src/commands/login.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

const KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("without an email it prints usage rather than guessing", async () => {
  const result = await runLogin(cliDir, []);

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("bogey login <email>");
});

test("a publishable key is refused with the reason", async () => {
  process.env.SUPABASE_URL = "http://localhost:8000";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_abc";

  const result = await runLogin(cliDir, ["someone@example.test"]);

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("publishable");
});

test("an unreachable instance is reported as such, not as a bad account", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_definitely_not_real";

  const result = await runLogin(cliDir, ["someone@example.test"]);

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("didn't answer");
  expect(result.output).not.toContain("No account for");
});

const originalFetch = globalThis.fetch;
let calls: string[] = [];

function stubApi(lookup: (url: string) => { status: number; body: unknown } | "network-error") {
  calls = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);

    const result = lookup(url);
    if (result === "network-error") throw new Error("ECONNREFUSED");

    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as typeof fetch;
}

function usedGenerateLink(): boolean {
  return calls.some((url) => url.includes("generate_link"));
}

const CODE = { email_otp: "123456", action_link: "https://example.test/verify" };

function withEnv() {
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_testing";
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("prints a code for an account that exists", async () => {
  withEnv();
  stubApi((url) => ({
    status: 200,
    body: url.includes("generate_link") ? CODE : { users: [{ email: "ada@example.test" }] },
  }));

  const result = await runLogin(cliDir, ["ada@example.test"]);

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("123456");
});

test("refuses an unknown address without creating it", async () => {
  withEnv();
  stubApi((url) => ({ status: 200, body: url.includes("generate_link") ? CODE : { users: [] } }));

  const result = await runLogin(cliDir, ["typo@example.test"]);

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("No account for typo@example.test");
  expect(usedGenerateLink()).toBe(false);
});

test("--create opts back in", async () => {
  withEnv();
  stubApi((url) => ({ status: 200, body: url.includes("generate_link") ? CODE : { users: [] } }));

  const result = await runLogin(cliDir, ["new@example.test", "--create"]);

  expect(result.exitCode).toBe(0);
  expect(usedGenerateLink()).toBe(true);
});

test("--create provisions the account itself, so invite-only orgs accept it", async () => {
  withEnv();
  const bodies: string[] = [];
  const stub = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (init?.method === "POST" && url.endsWith("/auth/v1/admin/users")) {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
    }
    return new Response(JSON.stringify(url.includes("generate_link") ? CODE : { users: [] }), {
      status: 200,
    });
  }) as typeof fetch;
  calls = [];
  globalThis.fetch = stub;

  const result = await runLogin(cliDir, ["new@example.test", "--create"]);

  expect(result.exitCode).toBe(0);
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!)).toMatchObject({ app_metadata: { bogey_provisioned: true } });
});

test("a lookup it can't read is 'don't know', not 'doesn't exist'", async () => {
  withEnv();
  stubApi((url) => ({
    status: 200,
    body: url.includes("generate_link") ? CODE : { unexpected: true },
  }));

  const result = await runLogin(cliDir, ["ada@example.test"]);

  expect(result.exitCode).toBe(1);
  expect(usedGenerateLink()).toBe(false);
});

test("a substring match on a different address does not count as existing", async () => {
  withEnv();
  stubApi((url) => ({
    status: 200,
    body: url.includes("generate_link") ? CODE : { users: [{ email: "ada@example.test.au" }] },
  }));

  const result = await runLogin(cliDir, ["ada@example.test"]);

  expect(result.exitCode).toBe(1);
  expect(usedGenerateLink()).toBe(false);
});
