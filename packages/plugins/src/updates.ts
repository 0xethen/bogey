import { compareVersions, parseRepository } from "./api.ts";
import { fetchLibrary } from "./library.ts";
import type { PluginManifest } from "./types.ts";

export type UpdateState = "current" | "outdated" | "unknown";

export interface PluginUpdate {
  key: string;
  name: string;
  installed: string;
  state: UpdateState;
  latest?: string;
  detail?: string;
  url?: string;
}

export type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export const httpFetcher: Fetcher = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
  };
};

const COMPARABLE = /^\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)*$/;

const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "bogey-plugin-updater",
};

export type UpdateSource = Pick<PluginManifest, "key" | "name" | "version" | "source">;

export async function fetchLatestVersion(
  manifest: UpdateSource,
  fetcher: Fetcher,
): Promise<{ version: string; url?: string } | { error: string; url?: string }> {
  if (!manifest.source) return { error: "no source repository" };

  const parsed = parseRepository(manifest.source.repository);
  if (!parsed) return { error: "unreadable repository" };

  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;

  if (manifest.source.directory) {
    const library = await fetchLibrary(`github:${parsed.owner}/${parsed.repo}`, fetcher);
    const entry = library.ok
      ? library.index.plugins.find((plugin) => plugin.key === manifest.key)
      : undefined;
    if (entry) return { version: entry.version, url: `${parsed.url}/releases/tag/${entry.tag}` };
  }

  try {
    const release = manifest.source.directory
      ? { ok: false, status: 404, json: async () => null, text: async () => "" }
      : await fetcher(`${api}/releases/latest`, { headers: GITHUB_HEADERS });

    if (release.ok) {
      const body = (await release.json()) as { tag_name?: string; html_url?: string };
      const tag = body.tag_name?.replace(/^v/, "");

      if (tag && COMPARABLE.test(tag)) return { version: tag, url: body.html_url };

      if (tag) {
        return {
          error: `latest release "${body.tag_name}" isn't a version we can compare`,
          url: body.html_url,
        };
      }
    } else if (release.status === 403) {
      return { error: "GitHub rate limit reached. Try again later." };
    } else if (release.status === 404 && !manifest.source.directory) {
    }
  } catch (error) {
    return { error: `couldn't reach GitHub (${String(error)})` };
  }

  const directory = manifest.source.directory?.replace(/^\/+|\/+$/g, "");
  const path = directory ? `${directory}/manifest.ts` : "manifest.ts";

  for (const branch of ["main", "master"]) {
    try {
      const raw = await fetcher(
        `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${path}`,
      );

      if (!raw.ok) continue;

      const source = await raw.text();
      const version = /^\s*version:\s*"([^"]+)"/m.exec(source)?.[1];

      if (version && COMPARABLE.test(version)) {
        return { version, url: `${parsed.url}/blob/${branch}/${path}` };
      }

      if (version) {
        return { error: `manifest version "${version}" isn't a version we can compare` };
      }
    } catch {}
  }

  return { error: "no release and no readable manifest" };
}

export async function checkPluginUpdates(
  manifests: Tuple<UpdateSource>,
  fetcher: Fetcher,
): Promise<PluginUpdate[]> {
  return Promise.all(
    manifests.map(async (manifest): Promise<PluginUpdate> => {
      const base = { key: manifest.key, name: manifest.name, installed: manifest.version };

      const result = await fetchLatestVersion(manifest, fetcher);

      if ("error" in result) {
        return { ...base, state: "unknown", detail: result.error, url: result.url };
      }

      return {
        ...base,
        state: compareVersions(result.version, manifest.version) > 0 ? "outdated" : "current",
        latest: result.version,
        url: result.url,
      };
    }),
  );
}
