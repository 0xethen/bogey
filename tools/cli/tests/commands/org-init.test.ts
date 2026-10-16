import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { askOrgInit, orgInitCommand, runOrgInit, USAGE } from "../../src/commands/org-init.ts";
import { scripted } from "../support/prompter.ts";

test("without the flags or a terminal, it prints the usage", async () => {
  const result = await runOrgInit("/nowhere", ["--org", "acme"], null);
  expect(result).toEqual({ exitCode: 1, output: USAGE });
});

test("at a terminal it asks for what the flags leave out", async () => {
  const { prompter, asked } = scripted(["Acme Hack Club", "", "you@acme.org", "", true]);
  const answers = await askOrgInit(prompter, {});
  expect(answers).toEqual({
    name: "Acme Hack Club",
    org: "acme-hack-club",
    owner: "you@acme.org",
    host: undefined,
    demo: true,
  });
  expect(asked).toHaveLength(5);
});

test("flags given aren't asked again", async () => {
  const { prompter, asked } = scripted(["you@acme.org", "hacks.acme.org"]);
  const answers = await askOrgInit(prompter, { org: "acme", name: "Acme", demo: true });
  expect(answers).toEqual({
    org: "acme",
    name: "Acme",
    owner: "you@acme.org",
    host: "hacks.acme.org",
    demo: true,
  });
  expect(asked).toEqual(["Owner's email", "Hostname"]);
});

test("a bad address or email is asked again", async () => {
  const { prompter } = scripted(["Acme", "Not A Slug"]);
  await expect(askOrgInit(prompter, {})).rejects.toThrow(/Lowercase letters/);
});

test("the answers come back as the command to skip the questions", () => {
  expect(
    orgInitCommand({
      org: "acme",
      name: 'Acme "Hack" Club',
      owner: "you@acme.org",
      host: undefined,
      demo: true,
    }),
  ).toBe('bogey org init --org acme --name "Acme \\"Hack\\" Club" --owner you@acme.org --demo');
});

describe("the app address for queued email", () => {
  let stored: Array<{ value: Record<string, unknown> }> = [];
  let orgs: Array<{ slug: string }> = [];
  const requests: Array<{ method: string; url: string; body: string | null }> = [];

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "bogey-org-init-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    writeFileSync(
      join(root, ".env"),
      "SUPABASE_URL=http://db.test\nSUPABASE_SERVICE_ROLE_KEY=service-key\n",
    );
    vi.stubEnv("BOGEY_HOME", "");
    requests.length = 0;
    orgs = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url: String(url),
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (String(url).includes("/auth/v1/admin/users") && method === "GET") {
        return new Response(JSON.stringify({ users: [{ id: "u1", email: "you@acme.org" }] }));
      }
      if (String(url).includes("/rpc/bogey_bootstrap"))
        return new Response(JSON.stringify("org-1"));
      if (String(url).includes("/rest/v1/orgs") && method === "GET") {
        return new Response(JSON.stringify(orgs));
      }
      if (String(url).includes("/rest/v1/settings") && method === "GET") {
        return new Response(JSON.stringify(stored));
      }
      return new Response("[]");
    });
    roots.push(root);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const roots: string[] = [];
  const orgInit = (extra: string[] = []) =>
    runOrgInit(roots.at(-1) ?? "", [
      "--org",
      "acme",
      "--name",
      "Acme",
      "--owner",
      "you@acme.org",
      ...extra,
    ]);
  const writes = () =>
    requests.filter(
      (request) => request.url.includes("/rest/v1/settings") && request.method !== "GET",
    );

  test("BOGEY_APP_URL fills it in when none is set", async () => {
    stored = [];
    vi.stubEnv("BOGEY_APP_URL", "http://web:3000");
    const result = await orgInit();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("http://web:3000");
    expect(JSON.parse(writes()[0]?.body ?? "{}")).toEqual({
      scope: "instance",
      namespace: "tenancy",
      value: { appUrl: "http://web:3000" },
    });
  });

  test("an address an admin already chose stays", async () => {
    stored = [{ value: { appUrl: "https://hacks.example.org" } }];
    vi.stubEnv("BOGEY_APP_URL", "http://web:3000");
    await orgInit();
    expect(writes()).toHaveLength(0);
  });

  test("--app-url replaces it, keeping the rest of the namespace", async () => {
    stored = [{ value: { appUrl: "https://old.example.org", defaultOrg: "x" } }];
    await orgInit(["--app-url", "https://new.example.org"]);
    expect(writes()[0]?.method).toBe("PATCH");
    expect(JSON.parse(writes()[0]?.body ?? "{}")).toEqual({
      value: { appUrl: "https://new.example.org", defaultOrg: "x" },
    });
  });

  test("once there's an org, it won't make another first one", async () => {
    orgs = [{ slug: "other" }];
    const result = await orgInit();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("bogey org create");
    expect(requests.some((request) => request.url.includes("bogey_bootstrap"))).toBe(false);
  });

  test("but running it again for the same org is fine", async () => {
    orgs = [{ slug: "acme" }];
    expect((await orgInit()).exitCode).toBe(0);
  });
});
