import { describe, expect, test } from "vite-plus/test";
import { disabledPlugins } from "@bogey/config";
import {
  availablePlugins,
  findPlugin,
  installedPlugins,
  pluginMenubarItems,
  type LoadedSlots,
} from "../src/registry.ts";
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

  test("menubar items keep only their kind, a bare component being a button", () => {
    const Bare = () => null;
    const Menu = () => null;
    const manifest = availablePlugins[0]!;
    const loaded = [
      { key: "a", manifest, slots: { menubar: Bare }, actions: {} },
      { key: "b", manifest, slots: {}, actions: {} },
      { key: "c", manifest, slots: { menubar: { kind: "menu", component: Menu } }, actions: {} },
      { key: "d", manifest, slots: { menubar: { kind: "button", component: Bare } }, actions: {} },
    ] satisfies LoadedSlots[];
    expect(pluginMenubarItems("button", loaded).map((item) => [item.key, item.Component])).toEqual([
      ["a", Bare],
      ["d", Bare],
    ]);
    expect(pluginMenubarItems("menu", loaded).map((item) => item.key)).toEqual(["c"]);
  });
});
