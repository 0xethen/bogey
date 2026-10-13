import { describe, expect, test } from "vite-plus/test";
import { disabledPlugins } from "@bogey/config";
import { availablePlugins, findPlugin, installedPlugins } from "../src/registry.ts";
import { pluginPageUrl, pluginRoutes } from "../src/api.ts";

describe("registry", () => {
  test("keys are unique and sorted", () => {
    const keys = availablePlugins.map((manifest) => manifest.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort());
  });

  test("disabled plugins are not installed", () => {
    for (const key of disabledPlugins) expect(findPlugin(key)).toBeUndefined();
  });

  test("an unknown key resolves to nothing", () => {
    expect(findPlugin("not-a-plugin")).toBeUndefined();
  });

  test("every route is namespaced under its area's /x/<key>", () => {
    for (const route of pluginRoutes(installedPlugins())) {
      expect(pluginPageUrl(route, route.area, route.path, "spring")).toMatch(
        new RegExp(`^(/events/spring(/manage)?|/org|/account|/admin)?/x/${route.key}(/|$)`),
      );
    }
  });
});
