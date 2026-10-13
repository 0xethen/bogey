import { describe, expect, test } from "vite-plus/test";

import { isExternalHref as isExternal, sanitizeHref } from "../src/components/markdown.tsx";

describe("protocol allowlist", () => {
  test("ordinary links survive", () => {
    for (const href of [
      "https://example.com",
      "http://example.com",
      "mailto:someone@example.com",
      "/event/hg6",
      "#rules",
      "?tab=teams",
      "relative/path",
    ]) {
      expect(sanitizeHref(href)).toBe(href);
    }
  });

  test("script-bearing protocols lose their href", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)".trim(),
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(sanitizeHref(href)).toBeUndefined();
    }
  });

  test("it is an allowlist, so an unknown scheme is refused by default", () => {
    expect(sanitizeHref("intent://scan#Intent;end")).toBeUndefined();
    expect(sanitizeHref("chrome://settings")).toBeUndefined();
    expect(sanitizeHref("blob:https://example.com/uuid")).toBeUndefined();
  });

  test("a colon that isn't a protocol doesn't trip it", () => {
    expect(sanitizeHref("/docs/a:b")).toBe("/docs/a:b");
    expect(sanitizeHref("#section:2")).toBe("#section:2");
  });
});

describe("external links", () => {
  test("only absolute http(s) counts as leaving", () => {
    expect(isExternal("https://example.com")).toBe(true);
    expect(isExternal("http://example.com")).toBe(true);
    expect(isExternal("/event/hg6")).toBe(false);
    expect(isExternal("mailto:a@b.com")).toBe(false);
  });

  test("anything opening a new tab is the case that needs noopener", () => {
    const external = ["https://example.com", "http://example.com"];
    for (const href of external) expect(isExternal(href)).toBe(true);
  });
});
