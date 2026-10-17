import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { findConfigFile, loadConfig } from "../src/load.ts";
import {
  configProblems,
  operatorChanges,
  publicConfigOf,
  publicConfigScript,
  resolveConfig,
  securityHeadersOf,
  updateChecksOn,
} from "../src/resolve.ts";

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bogey-config-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("defaults fill in everything but the brand name", () => {
  const config = resolveConfig({ brand: { name: "Acme" } });
  expect(config.disabledPlugins).toEqual([]);
  expect(config.security.verboseErrors).toBe(false);
  expect(config.upstream).toBe("github:0xethen/bogey");
  expect(config.repository).toBe(config.upstream);
  expect(config.updateCheck).toBe(true);
});

test("repository false removes the issue tracker", () => {
  expect(resolveConfig({ brand: { name: "Acme" }, repository: false }).repository).toBeNull();
});

test("problems name the key and what is wrong", () => {
  expect(configProblems({ brand: { name: "Acme", theme: "nope" } })[0]).toMatch(/^brand\.theme/);
  expect(configProblems({ brand: { name: "" } })[0]).toMatch(/brand\.name/);
  expect(configProblems({ brand: { name: "A" }, upstream: "owner/repo" })[0]).toMatch(/upstream/);
  expect(configProblems({})[0]).toMatch(/brand/);
  expect(configProblems({ brand: { name: "A" } })).toEqual([]);
});

test("the browser gets the brand and plugin list, not update or upstream settings", () => {
  const config = resolveConfig({
    brand: { name: "Acme" },
    plugins: { disabled: ["x"] },
    security: { verboseErrors: true },
  });
  const sent = publicConfigOf(config);
  expect(Object.keys(sent).sort()).toEqual([
    "brand",
    "disabledPlugins",
    "eventDeletion",
    "repository",
    "verboseErrors",
  ]);
  expect(sent.disabledPlugins).toEqual(["x"]);
});

test("the inline script can't close its own tag", () => {
  const script = publicConfigScript({
    brand: { name: "</script><b>" },
    repository: null,
    disabledPlugins: [],
    eventDeletion: true,
    verboseErrors: false,
  });
  expect(script).not.toContain("</script>");
});

test("BOGEY_UPDATE_CHECK turns checks off even when the config leaves them on", () => {
  const config = resolveConfig({ brand: { name: "A" } });
  expect(updateChecksOn(config, {})).toBe(true);
  expect(updateChecksOn(config, { BOGEY_UPDATE_CHECK: "off" })).toBe(false);
  expect(
    updateChecksOn(resolveConfig({ brand: { name: "A" }, updates: { check: false } }), {}),
  ).toBe(false);
});

test("a json file loads", () => {
  const dir = folder({ "bogey.config.json": JSON.stringify({ brand: { name: "Json Co" } }) });
  const loaded = loadConfig({}, dir);
  expect(loaded.config.brand.name).toBe("Json Co");
  expect(loaded.file).toBe(join(dir, "bogey.config.json"));
});

test("a TypeScript file loads without a build, with type-only imports erased", () => {
  const dir = folder({
    "bogey.config.ts": `import type { InstanceConfig } from "@bogey/config/define";
export default { brand: { name: "Ts Co" }, plugins: { disabled: ["a"] } } satisfies InstanceConfig;
`,
  });
  const loaded = loadConfig({}, dir);
  expect(loaded.config.brand.name).toBe("Ts Co");
  expect(loaded.config.disabledPlugins).toEqual(["a"]);
});

test("the nearest file upward wins, and BOGEY_CONFIG overrides the search", () => {
  const dir = folder({ "bogey.config.json": JSON.stringify({ brand: { name: "Outer" } }) });
  const inner = join(dir, "apps", "web");
  mkdirSync(inner, { recursive: true });
  expect(findConfigFile({}, inner)).toBe(join(dir, "bogey.config.json"));
  const other = folder({ "mine.json": JSON.stringify({ brand: { name: "Mine" } }) });
  expect(loadConfig({ BOGEY_CONFIG: join(other, "mine.json") }, dir).config.brand.name).toBe(
    "Mine",
  );
});

test("a file that isn't valid names itself and the problem", () => {
  const dir = folder({ "bogey.config.json": JSON.stringify({ brand: { name: "" } }) });
  expect(() => loadConfig({}, dir)).toThrow(/bogey\.config\.json isn't valid[\s\S]*brand\.name/);
  const broken = folder({ "bogey.config.json": "{ nope" });
  expect(() => loadConfig({}, broken)).toThrow(/Couldn't read/);
  expect(() => loadConfig({ BOGEY_CONFIG: join(dir, "gone.json") }, dir)).toThrow(/doesn't exist/);
});

test("only the operator keys the file declares go to the database", () => {
  const config = resolveConfig({
    brand: { name: "Acme" },
    appUrl: "https://hacks.acme.org",
    network: { trustProxy: true, trustedProxies: ["10.0.0.0/8"] },
    security: { verboseErrors: true },
  });
  expect(config.operator).toEqual({
    tenancy: { appUrl: "https://hacks.acme.org" },
    network: { trustedProxies: ["10.0.0.0/8"] },
  });
  expect(config.trustProxy).toBe(true);
  expect(resolveConfig({ brand: { name: "Acme" } }).operator).toEqual({});
});

test("operator keys are checked like the settings they become", () => {
  expect(
    configProblems({ brand: { name: "A" }, network: { trustedProxies: ["nope"] } })[0],
  ).toMatch(/^network\.trustedProxies/);
  expect(configProblems({ brand: { name: "A" }, network: { trustedHops: 0 } })[0]).toMatch(
    /^network\.trustedHops/,
  );
  expect(configProblems({ brand: { name: "A" }, security: { requireAdminMFA: true } })[0]).toMatch(
    /security/,
  );
});

test("device sign-out is an operator key, off unless declared", () => {
  expect(resolveConfig({ brand: { name: "A" } }).operator).toEqual({});
  expect(
    resolveConfig({ brand: { name: "A" }, security: { deviceSignOut: true } }).operator,
  ).toEqual({ accounts: { deviceSignOut: true } });
});

test("sign-in emails come from the file and must keep their code and link", () => {
  const signIn = { subject: "Sign in", body: "{{code}} or {{link}}" };
  expect(
    resolveConfig({ brand: { name: "A" }, email: { authTemplates: { signIn } } })
      .authEmailTemplates,
  ).toEqual({ signIn });
  expect(
    configProblems({
      brand: { name: "A" },
      email: { authTemplates: { signIn: { subject: "Hi", body: "click evil.example" } } },
    })[0],
  ).toMatch(/^email\.authTemplates\.signIn/);
  expect(
    configProblems({ brand: { name: "A" }, email: { authTemplates: { welcome: signIn } } })[0],
  ).toMatch(/only signIn/);
});

test("a change keeps the database's other keys and names only what differs", () => {
  const changes = operatorChanges(
    { accounts: { requireAdminMfa: true }, network: { trustedHops: 2 } },
    { accounts: { requireAdminMfa: true, portfolios: true }, network: { trustedHops: 1 } },
  );
  expect(changes).toEqual([
    { namespace: "network", value: { trustedHops: 2 }, keys: ["trustedHops"] },
  ]);
  expect(operatorChanges({ accounts: { requireAdminMfa: false } }, {})).toEqual([
    { namespace: "accounts", value: { requireAdminMfa: false }, keys: ["requireAdminMfa"] },
  ]);
});

test("security headers default to same-origin framing and no HSTS", () => {
  const headers = securityHeadersOf(resolveConfig({ brand: { name: "A" } }).security.headers);
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toBeUndefined();
});

test("a policy and framing origins combine into one header", () => {
  const headers = securityHeadersOf(
    resolveConfig({
      brand: { name: "A" },
      security: {
        headers: {
          frameAncestors: ["https://lms.acme.org"],
          hsts: true,
          contentSecurityPolicy: "default-src 'self'",
        },
      },
    }).security.headers,
  );
  expect(headers["content-security-policy"]).toBe(
    "default-src 'self'; frame-ancestors https://lms.acme.org",
  );
  expect(headers["x-frame-options"]).toBeUndefined();
  expect(headers["strict-transport-security"]).toBe("max-age=15552000");
});

test("events can be deleted from the UI unless the config says not", () => {
  expect(resolveConfig({ brand: { name: "A" } }).eventDeletion).toBe(true);
  expect(resolveConfig({ brand: { name: "A" }, events: { uiDeletion: false } }).eventDeletion).toBe(
    false,
  );
});
