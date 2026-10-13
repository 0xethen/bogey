import { describe, expect, test } from "vite-plus/test";
import {
  KEBAB,
  NAMESPACED_KEY,
  PLUGIN_KEY,
  SEMVER,
  SNAKE_KEBAB,
  toSlug,
  typedSlug,
} from "../src/keys.ts";

describe("PLUGIN_KEY", () => {
  test.each(["challenges", "dvd-loader", "april-fools-2026", "abc"])("accepts %s", (k) =>
    expect(PLUGIN_KEY.test(k)).toBe(true),
  );
  test.each(["ab", "Challenges", "1abc", "abc-", "a_b_c", "a".repeat(33)])("rejects %s", (k) =>
    expect(PLUGIN_KEY.test(k)).toBe(false),
  );
});

test("KEBAB and SNAKE_KEBAB", () => {
  expect(KEBAB.test("ai-division")).toBe(true);
  expect(KEBAB.test("ai_division")).toBe(false);
  expect(SNAKE_KEBAB.test("editor_tab-size")).toBe(true);
  expect(SNAKE_KEBAB.test("-x")).toBe(false);
});

test("NAMESPACED_KEY", () => {
  expect(NAMESPACED_KEY.test("forms.mentor")).toBe(true);
  expect(NAMESPACED_KEY.test("mentor")).toBe(false);
  expect(NAMESPACED_KEY.test("forms.mentor.x")).toBe(false);
});

test("SEMVER", () => {
  expect(SEMVER.test("1.2.3")).toBe(true);
  expect(SEMVER.test("1.2.3-beta.1")).toBe(true);
  expect(SEMVER.test("v1")).toBe(false);
  expect(SEMVER.test("latest")).toBe(false);
});

describe("toSlug", () => {
  test("lowercases, dashes and trims", () => {
    expect(toSlug("  Demo Cup 2026! ")).toBe("demo-cup-2026");
    expect(toSlug("Café Hack")).toBe("cafe-hack");
  });
  test("cuts to the limit", () => expect(toSlug("a".repeat(80), 40)).toHaveLength(40));
});

describe("typedSlug", () => {
  test("keeps dashes, including a trailing one mid-typing", () =>
    expect(typedSlug("spring-")).toBe("spring-"));
  test("lowercases and dashes the rest without changing the length", () =>
    expect(typedSlug("My Hack_2")).toBe("my-hack-2"));
});
