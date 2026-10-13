import { expect, test } from "vite-plus/test";
import { effectiveProviders, isSignInProvider, providerLabel } from "../src/sign-in.ts";
import { settingsRegistry } from "../src/settings.ts";

test("an organization narrows the instance's list but can't add to it", () => {
  expect(effectiveProviders(["google", "github"], undefined)).toEqual(["google", "github"]);
  expect(effectiveProviders(["google", "github"], ["github"])).toEqual(["github"]);
  expect(effectiveProviders(["google"], ["google", "gitlab"])).toEqual(["google"]);
  expect(effectiveProviders(["google"], [])).toEqual([]);
  expect(effectiveProviders(undefined, ["google"])).toEqual([]);
});

test("providers are known by key", () => {
  expect(isSignInProvider("azure")).toBe(true);
  expect(isSignInProvider("facebook")).toBe(false);
  expect(providerLabel("azure")).toBe("Microsoft");
});

test("the signin setting takes only known providers, and defaults to none", () => {
  const { schema, defaults } = settingsRegistry.signin;
  expect(defaults.providers).toEqual([]);
  expect(schema.safeParse({ providers: ["google", "sso"] }).success).toBe(true);
  expect(schema.safeParse({ providers: ["facebook"] }).success).toBe(false);
});
