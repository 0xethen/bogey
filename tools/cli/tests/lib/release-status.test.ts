import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { Fetcher } from "@bogey/plugins/updates";
import { describeRelease, releaseCheck } from "../../src/lib/release-status.ts";

function checkout(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "bogey-release-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  return root;
}

const fetcher: Fetcher = async (url) => ({
  ok: true,
  status: 200,
  json: async () =>
    url.includes("/security-advisories")
      ? [
          {
            ghsa_id: "GHSA-aaaa-bbbb-cccc",
            html_url: "https://github.com/0xethen/bogey/security/advisories/GHSA-aaaa-bbbb-cccc",
            summary: "Org admins could read another organization's registrations",
            severity: "high",
            vulnerabilities: [
              { vulnerable_version_range: ">= 2.0.0, < 2.0.2", patched_versions: "2.0.2" },
            ],
          },
        ]
      : { tag_name: "v2.0.2", html_url: "https://github.com/0xethen/bogey/releases/tag/v2.0.2" },
  text: async () => "",
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("releaseCheck", () => {
  test("names the advisory and the release that fixes it", async () => {
    const check = await releaseCheck(checkout("2.0.1"), fetcher);
    expect(check).not.toBeNull();
    const notices = describeRelease(check!);
    expect(notices.advisories).toEqual([
      "Bogey 2.0.1 is affected by GHSA-aaaa-bbbb-cccc (high): Org admins could read another organization's registrations. Fixed in 2.0.2. https://github.com/0xethen/bogey/security/advisories/GHSA-aaaa-bbbb-cccc",
    ]);
    expect(notices.newer).toMatch(/^Bogey 2\.0\.2 is out \(this is 2\.0\.1\)/);
  });

  test("says nothing for a fixed version", async () => {
    const check = await releaseCheck(checkout("2.0.2"), fetcher);
    expect(describeRelease(check!)).toEqual({ advisories: [], newer: null });
  });

  test("doesn't ask when update checks are off", async () => {
    vi.stubEnv("BOGEY_UPDATE_CHECK", "off");
    const asked = vi.fn(fetcher);
    expect(await releaseCheck(checkout("2.0.1"), asked)).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});
