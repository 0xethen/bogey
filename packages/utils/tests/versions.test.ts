import { describe, expect, it } from "vite-plus/test";
import { compareSemver, inVersionRange } from "../src/versions.ts";

describe("compareSemver", () => {
  it("orders releases and prereleases", () => {
    expect(compareSemver("2.0.1", "2.0.0")).toBe(1);
    expect(compareSemver("2.0.0", "10.0.0")).toBe(-1);
    expect(compareSemver("2.0.0-rc.1", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0-rc.2", "2.0.0-rc.10")).toBe(-1);
    expect(compareSemver("2.0.0-rc.1", "2.0.0-rc.1")).toBe(0);
    expect(compareSemver("2.0.0+build.5", "2.0.0")).toBe(0);
  });

  it("keeps hyphens inside the prerelease", () => {
    expect(compareSemver("2.0.0-pre-a", "2.0.0-pre-b")).toBe(-1);
  });
});

describe("inVersionRange", () => {
  it("reads GitHub advisory ranges", () => {
    expect(inVersionRange("2.0.1", ">= 2.0.0, < 2.0.3")).toBe(true);
    expect(inVersionRange("2.0.3", ">= 2.0.0, < 2.0.3")).toBe(false);
    expect(inVersionRange("1.9.9", ">= 2.0.0, < 2.0.3")).toBe(false);
    expect(inVersionRange("2.0.2", "< 2.0.3")).toBe(true);
    expect(inVersionRange("2.0.1", "= 2.0.1")).toBe(true);
    expect(inVersionRange("2.0.1", "2.0.1")).toBe(true);
    expect(inVersionRange("2.0.2", "<= 2.0.1")).toBe(false);
  });

  it("counts a prerelease of the fix as affected", () => {
    expect(inVersionRange("2.0.3-rc.1", "< 2.0.3")).toBe(true);
  });

  it("takes alternatives", () => {
    expect(inVersionRange("2.1.0", "< 2.0.3 || >= 2.1.0, < 2.1.1")).toBe(true);
    expect(inVersionRange("2.0.5", "< 2.0.3 || >= 2.1.0, < 2.1.1")).toBe(false);
  });

  it("returns null for ranges it can't read", () => {
    expect(inVersionRange("2.0.1", "")).toBeNull();
    expect(inVersionRange("2.0.1", "~2.0")).toBeNull();
    expect(inVersionRange("2.0.1", "all versions")).toBeNull();
  });
});
