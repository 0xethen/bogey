import { describe, expect, test } from "vite-plus/test";
import {
  optionalText,
  optionalUrl,
  requireId,
  requireNumber,
  requireOneOf,
  requireSlug,
  requireText,
} from "../../src/queries/validate.ts";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("requireId", () => {
  test("accepts a UUID", () => {
    expect(requireId(UUID, "id")).toBe(UUID);
  });

  test("rejects strings that aren't UUIDs", () => {
    expect(() => requireId("not-a-uuid", "id")).toThrow(/UUID/);
    expect(() => requireId("", "id")).toThrow();
    expect(() => requireId("' or 1=1 --", "id")).toThrow();
  });

  test("rejects non-strings", () => {
    expect(() => requireId(undefined, "id")).toThrow();
    expect(() => requireId(42, "id")).toThrow();
    expect(() => requireId({ id: UUID }, "id")).toThrow();
  });
});

describe("requireSlug", () => {
  test("accepts lowercase kebab", () => {
    expect(requireSlug("spring-jam-2026", "slug")).toBe("spring-jam-2026");
  });

  test("rejects anything else", () => {
    expect(() => requireSlug("Has Spaces", "slug")).toThrow();
    expect(() => requireSlug("UPPER", "slug")).toThrow();
    expect(() => requireSlug("trailing-", "slug")).toThrow();
    expect(() => requireSlug("a".repeat(65), "slug")).toThrow();
  });
});

describe("requireText", () => {
  test("trims", () => {
    expect(requireText("  hello  ", "body")).toBe("hello");
  });

  test("rejects whitespace-only, which a NOT NULL column would accept", () => {
    expect(() => requireText("   ", "body")).toThrow(/empty/);
    expect(() => requireText("", "body")).toThrow();
  });

  test("enforces a length ceiling", () => {
    expect(() => requireText("x".repeat(11), "body", 10)).toThrow(/too long/);
  });

  test("optionalText maps empty to null rather than throwing", () => {
    expect(optionalText(undefined, "body")).toBeNull();
    expect(optionalText("", "body")).toBeNull();
    expect(optionalText("  ok  ", "body")).toBe("ok");
  });
});

describe("requireOneOf", () => {
  test("accepts a listed value and rejects the rest", () => {
    expect(requireOneOf("draft", ["draft", "submitted"], "status")).toBe("draft");
    expect(() => requireOneOf("disqualified", ["draft", "submitted"], "status")).toThrow();
  });
});

describe("requireNumber", () => {
  test("accepts an in-range number", () => {
    expect(requireNumber(5, "value", 0, 10)).toBe(5);
    expect(requireNumber(0, "value", 0, 10)).toBe(0);
  });

  test("rejects out of range", () => {
    expect(() => requireNumber(11, "value", 0, 10)).toThrow();
    expect(() => requireNumber(-1, "value", 0, 10)).toThrow();
  });

  test("rejects NaN and Infinity, which survive typeof number", () => {
    expect(() => requireNumber(Number.NaN, "value", 0, 10)).toThrow();
    expect(() => requireNumber(Number.POSITIVE_INFINITY, "value", 0, 10)).toThrow();
  });
});

describe("optionalUrl", () => {
  test("accepts http(s)", () => {
    expect(optionalUrl("https://example.com/repo", "repo")).toBe("https://example.com/repo");
  });

  test("rejects schemes a browser would happily execute", () => {
    expect(() => optionalUrl("javascript:alert(1)", "repo")).toThrow();
    expect(() => optionalUrl("data:text/html,<script>", "repo")).toThrow();
  });

  test("rejects things that aren't URLs at all", () => {
    expect(() => optionalUrl("github.com/me/repo", "repo")).toThrow(/full URL/);
  });

  test("absent stays absent", () => {
    expect(optionalUrl(undefined, "repo")).toBeNull();
    expect(optionalUrl("", "repo")).toBeNull();
  });
});
