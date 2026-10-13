import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  checkAuthHookWiring,
  checkDatabaseUrl,
  checkEnvFileSafety,
  checkPluginKeys,
} from "../../src/lib/checks.ts";

const configTomlPath = fileURLToPath(new URL("../../../../supabase/config.toml", import.meta.url));
const configToml = readFileSync(configTomlPath, "utf-8");

test("supabase/config.toml wires up the before_user_created auth hook", () => {
  expect(checkAuthHookWiring(configToml)).toEqual([]);
});

test("checkAuthHookWiring flags a disabled hook", () => {
  const broken = configToml.replace(
    "[auth.hook.before_user_created]\nenabled = true",
    "[auth.hook.before_user_created]\nenabled = false",
  );
  expect(broken).not.toEqual(configToml);
  expect(checkAuthHookWiring(broken).length).toBeGreaterThan(0);
});

test("checkAuthHookWiring flags enable_signup = false, which would silently disable the gate", () => {
  const broken = configToml.replace("enable_signup = true", "enable_signup = false");
  expect(broken).not.toEqual(configToml);
  expect(checkAuthHookWiring(broken).length).toBeGreaterThan(0);
});

test("checkEnvFileSafety passes a correctly-named service role key", () => {
  expect(checkEnvFileSafety("SUPABASE_SERVICE_ROLE_KEY=abc123\n")).toEqual([]);
});

test("checkEnvFileSafety flags a PUBLIC_-prefixed service role key", () => {
  const issues = checkEnvFileSafety("PUBLIC_SUPABASE_SERVICE_ROLE_KEY=abc123\n");
  expect(issues.length).toBe(1);
});

test("checkEnvFileSafety flags the VITE_ alias too", () => {
  const issues = checkEnvFileSafety("VITE_SUPABASE_SERVICE_ROLE_KEY=abc123\n");
  expect(issues.length).toBe(1);
});

test("checkDatabaseUrl flags the stock pooler tenant", () => {
  expect(checkDatabaseUrl("postgresql://postgres.your-tenant-id:pw@db:5432/postgres").length).toBe(
    1,
  );
  expect(checkDatabaseUrl("postgresql://postgres.bogey:pw@db:5432/postgres")).toEqual([]);
  expect(checkDatabaseUrl(null)).toEqual([]);
});

test("checkPluginKeys passes unique, well-formed keys", () => {
  expect(checkPluginKeys(["challenges", "dvd-loader"])).toEqual([]);
});

test("checkPluginKeys flags duplicate keys", () => {
  expect(checkPluginKeys(["checkin", "checkin"]).length).toBe(1);
});

test("checkPluginKeys flags a key that can't appear in a URL", () => {
  expect(checkPluginKeys(["Check_In"]).length).toBe(1);
});
