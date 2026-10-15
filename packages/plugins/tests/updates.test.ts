import { describe, expect, test } from "vite-plus/test";
import { checkPluginUpdates, fetchLatestVersion, type Fetcher } from "../src/updates.ts";
import type { PluginManifest } from "../src/types.ts";

const AUTHOR = { name: "Someone" };

function sourced(version: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return {
    key: "thing",
    name: "Thing",
    api: 1,
    version,
    description: "d",
    author: AUTHOR,
    source: { repository: "github:someone/thing" },
    ...extra,
  };
}

function fetcherFor(routes: Record<string, { status?: number; body?: unknown; text?: string }>) {
  const handler: Fetcher = async (url) => {
    const key = Object.keys(routes).find((fragment) => url.includes(fragment));
    const route = key ? routes[key]! : { status: 404 };
    const status = route.status ?? 200;

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body ?? {},
      text: async () => route.text ?? "",
    };
  };

  return handler;
}

describe("fetchLatestVersion", () => {
  test("reads the latest release tag, with or without a v prefix", async () => {
    const result = await fetchLatestVersion(
      sourced("1.0.0"),
      fetcherFor({ "releases/latest": { body: { tag_name: "v2.1.0", html_url: "u" } } }),
    );

    expect(result).toMatchObject({ version: "2.1.0", url: "u" });
  });

  test("falls back to the manifest when there are no releases", async () => {
    const result = await fetchLatestVersion(
      sourced("1.0.0"),
      fetcherFor({
        "releases/latest": { status: 404 },
        "raw.githubusercontent.com": { text: '  version: "3.4.5",\n' },
      }),
    );

    expect(result).toMatchObject({ version: "3.4.5" });
  });

  test("looks in the plugin's sub-directory for a monorepo", async () => {
    let requested = "";
    const handler: Fetcher = async (url) => {
      if (new URL(url).hostname === "raw.githubusercontent.com") requested = url;
      return {
        ok: url.includes("raw."),
        status: url.includes("raw.") ? 200 : 404,
        json: async () => ({}),
        text: async () => '  version: "1.2.3",',
      };
    };

    await fetchLatestVersion(
      sourced("1.0.0", { source: { repository: "github:a/b", directory: "packages/thing" } }),
      handler,
    );

    expect(requested).toContain("packages/thing/manifest.ts");
  });

  test("refuses a release tag it cannot order", async () => {
    const result = await fetchLatestVersion(
      sourced("1.0.0"),
      fetcherFor({ "releases/latest": { body: { tag_name: "release-2026-07-21-1305" } } }),
    );

    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("version");
  });

  test("names a rate limit rather than calling it 'no releases'", async () => {
    const result = await fetchLatestVersion(
      sourced("1.0.0"),
      fetcherFor({ "releases/latest": { status: 403 } }),
    );

    expect(result).toMatchObject({ error: expect.stringContaining("rate limit") });
  });
});

describe("checkPluginUpdates", () => {
  test("distinguishes outdated from current", async () => {
    const fetcher = fetcherFor({ "releases/latest": { body: { tag_name: "2.0.0" } } });

    const [behind] = await checkPluginUpdates([sourced("1.0.0")], fetcher);
    const [ahead] = await checkPluginUpdates([sourced("2.0.0")], fetcher);

    expect(behind).toMatchObject({ state: "outdated", latest: "2.0.0" });
    expect(ahead?.state).toBe("current");
  });

  test("a failed check is 'unknown', never 'current'", async () => {
    const [result] = await checkPluginUpdates(
      [sourced("1.0.0")],
      fetcherFor({ "releases/latest": { status: 500 } }),
    );

    expect(result?.state).toBe("unknown");
  });

  test("survives a fetcher that throws", async () => {
    const throwing: Fetcher = async () => {
      throw new Error("ECONNREFUSED");
    };

    const [result] = await checkPluginUpdates([sourced("1.0.0")], throwing);

    expect(result?.state).toBe("unknown");
    expect(result?.detail).toContain("couldn't reach");
  });
});
