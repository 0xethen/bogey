import { describe, expect, test } from "vite-plus/test";
import { safeInternalPath } from "../../src/auth.ts";

describe("safeInternalPath", () => {
  test("keeps a same-origin path, search and hash intact", () => {
    expect(safeInternalPath("/events")).toBe("/events");
    expect(safeInternalPath("/event/abc/submit?draft=1#top")).toBe("/event/abc/submit?draft=1#top");
  });

  test("rejects anything that resolves to another origin", () => {
    expect(safeInternalPath("//evil.tld")).toBeNull();
    expect(safeInternalPath("//evil.tld/events")).toBeNull();
    expect(safeInternalPath("/\\evil.tld")).toBeNull();
    expect(safeInternalPath("https://evil.tld")).toBeNull();
    expect(safeInternalPath("http://evil.tld")).toBeNull();
  });

  test("rejects relative and protocol-relative-ish values", () => {
    expect(safeInternalPath("events")).toBeNull();
    expect(safeInternalPath("../events")).toBeNull();
    expect(safeInternalPath("javascript:alert(1)")).toBeNull();
  });

  test("rejects the auth pages, which would bounce a signed-in user", () => {
    expect(safeInternalPath("/auth")).toBeNull();
    expect(safeInternalPath("/auth/login")).toBeNull();
    expect(safeInternalPath("/auth/confirm?code=x")).toBeNull();
    expect(safeInternalPath("/authors")).toBe("/authors");
  });

  test("rejects empty and missing values", () => {
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath("")).toBeNull();
  });
});
