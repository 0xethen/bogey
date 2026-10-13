import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { findConfigFile, loadConfig } from "../src/load.ts";
import {
  configProblems,
  publicConfigOf,
  publicConfigScript,
  resolveConfig,
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
