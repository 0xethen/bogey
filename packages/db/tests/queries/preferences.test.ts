import { describe, expect, test } from "vite-plus/test";
import { preferenceId, requirePreferenceRef } from "../../src/queries/preferences.ts";

describe("preferenceId", () => {
  test("joins namespace and key", () => {
    expect(preferenceId("i18n", "locale")).toBe("i18n:locale");
  });

  test("no legal namespace or key can contain the separator", () => {
    expect(() => requirePreferenceRef({ namespace: "a:b", key: "c", value: 1 })).toThrow();
    expect(() => requirePreferenceRef({ namespace: "a", key: "b:c", value: 1 })).toThrow();
  });
});

describe("requirePreferenceRef", () => {
  test("accepts a plugin key and a preference key", () => {
    expect(
      requirePreferenceRef({ namespace: "github-link", key: "auto_sync", value: true }),
    ).toEqual({ namespace: "github-link", key: "auto_sync", value: true });
  });

  test("accepts 'core' for settings core owns", () => {
    expect(
      requirePreferenceRef({ namespace: "core", key: "timezone", value: "UTC" }).namespace,
    ).toBe("core");
  });

  test("a preference has a value: null and undefined are refused, off is false", () => {
    expect(() => requirePreferenceRef({ namespace: "core", key: "timezone", value: null })).toThrow(
      /false/,
    );
    expect(() => requirePreferenceRef({ namespace: "core", key: "timezone" })).toThrow(/value/);
    expect(requirePreferenceRef({ namespace: "core", key: "x", value: false }).value).toBe(false);
    expect(
      requirePreferenceRef({ namespace: "core", key: "x", value: { a: [1, null] } }).value,
    ).toEqual({ a: [1, null] });
    expect(() => requirePreferenceRef({ namespace: "core", key: "x", value: () => 1 })).toThrow(
      /JSON/,
    );
  });

  test("rejects namespaces the table's check constraint would reject", () => {
    for (const namespace of [
      "Core",
      "core_",
      "_core",
      "-core",
      "1core",
      "co re",
      "",
      "core;drop",
    ]) {
      expect(() => requirePreferenceRef({ namespace, key: "k", value: 1 })).toThrow(/namespace/);
    }
  });

  test("rejects keys the table's check constraint would reject", () => {
    for (const key of ["Locale", "_locale", "-locale", "1locale", "lo cale", "", "locale!"]) {
      expect(() => requirePreferenceRef({ namespace: "core", key, value: 1 })).toThrow(/key/);
    }
  });

  test("underscores are legal in a key but not in a namespace", () => {
    expect(requirePreferenceRef({ namespace: "core", key: "auto_sync", value: 1 }).key).toBe(
      "auto_sync",
    );
    expect(() => requirePreferenceRef({ namespace: "my_plugin", key: "k", value: 1 })).toThrow();
  });

  test("rejects non-objects", () => {
    expect(() => requirePreferenceRef(undefined)).toThrow();
    expect(() => requirePreferenceRef("core:timezone")).toThrow();
  });
});
