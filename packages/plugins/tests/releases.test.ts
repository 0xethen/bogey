import { describe, expect, test } from "vite-plus/test";
import { checkRelease, fetchAdvisories } from "../src/releases.ts";
import type { Fetcher } from "../src/updates.ts";

function fetcherFor(routes: Record<string, { status?: number; body?: unknown }>): Fetcher {
  return async (url) => {
    const key = Object.keys(routes).find((fragment) => url.includes(fragment));
    const route = key ? routes[key]! : { status: 404 };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body ?? {},
      text: async () => "",
    };
  };
}

const ADVISORY = {
  ghsa_id: "GHSA-aaaa-bbbb-cccc",
  cve_id: "CVE-2026-0001",
  html_url: "https://github.com/0xethen/bogey/security/advisories/GHSA-aaaa-bbbb-cccc",
  summary: "Org admins could read another organization's registrations",
  severity: "high",
  withdrawn_at: null,
  vulnerabilities: [
    {
      package: { ecosystem: "other", name: "bogey" },
      vulnerable_version_range: ">= 2.0.0, < 2.0.2",
      patched_versions: "2.0.2",
    },
  ],
};

describe("fetchAdvisories", () => {
  test("keeps the advisories whose range includes the version", async () => {
    const fetcher = fetcherFor({ "/security-advisories": { body: [ADVISORY] } });
    expect(await fetchAdvisories("github:0xethen/bogey", "2.0.1", fetcher)).toEqual({
      advisories: [
        {
          id: "GHSA-aaaa-bbbb-cccc",
          cve: "CVE-2026-0001",
          summary: ADVISORY.summary,
          severity: "high",
          url: ADVISORY.html_url,
          affected: ">= 2.0.0, < 2.0.2",
          patched: "2.0.2",
        },
      ],
    });
    expect(await fetchAdvisories("github:0xethen/bogey", "2.0.2", fetcher)).toEqual({
      advisories: [],
    });
  });

  test("skips withdrawn advisories and ranges it can't read", async () => {
    const fetcher = fetcherFor({
      "/security-advisories": {
        body: [
          { ...ADVISORY, withdrawn_at: "2026-10-20T00:00:00Z" },
          {
            ...ADVISORY,
            ghsa_id: "GHSA-x",
            vulnerabilities: [{ vulnerable_version_range: "some", patched_versions: null }],
          },
        ],
      },
    });
    expect(await fetchAdvisories("github:0xethen/bogey", "2.0.1", fetcher)).toEqual({
      advisories: [],
    });
  });

  test("reports a rate limit and an unexpected answer as errors", async () => {
    expect(
      await fetchAdvisories(
        "github:0xethen/bogey",
        "2.0.1",
        fetcherFor({ "/security-advisories": { status: 403 } }),
      ),
    ).toEqual({ error: "GitHub rate limit reached. Try again later." });
    expect(
      await fetchAdvisories(
        "github:0xethen/bogey",
        "2.0.1",
        fetcherFor({ "/security-advisories": { body: { message: "nope" } } }),
      ),
    ).toHaveProperty("error");
  });
});

describe("checkRelease", () => {
  test("combines the latest release with the advisories", async () => {
    const fetcher = fetcherFor({
      "/releases/latest": {
        body: { tag_name: "v2.0.2", html_url: "https://github.com/0xethen/bogey/releases/v2.0.2" },
      },
      "/security-advisories": { body: [ADVISORY] },
    });
    const result = await checkRelease("2.0.1", "github:0xethen/bogey", fetcher);
    expect(result).toMatchObject({ current: "2.0.1", latest: "2.0.2", newer: true });
    expect(result.advisories.map((advisory) => advisory.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });

  test("counts the release as newer than its own release candidate", async () => {
    const fetcher = fetcherFor({
      "/releases/latest": { body: { tag_name: "v2.1.0" } },
      "/security-advisories": { body: [] },
    });
    expect(await checkRelease("2.1.0-rc.1", "github:0xethen/bogey", fetcher)).toMatchObject({
      newer: true,
      advisories: [],
    });
  });

  test("still reports advisories when the latest release can't be read", async () => {
    const fetcher = fetcherFor({ "/security-advisories": { body: [ADVISORY] } });
    const result = await checkRelease("2.0.0", "github:0xethen/bogey", fetcher);
    expect(result.latest).toBeNull();
    expect(result.advisories).toHaveLength(1);
  });
});
