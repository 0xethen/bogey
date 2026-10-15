import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstream } from "@bogey/config";
import { loadConfig } from "@bogey/config/load";
import { updateChecksOn, type ResolvedConfig } from "@bogey/config/resolve";
import { parseRepository } from "@bogey/plugins/api";
import { checkRelease, type ReleaseCheck } from "@bogey/plugins/releases";
import { httpFetcher, type Fetcher } from "@bogey/plugins/updates";
import { compareSemver } from "@bogey/utils/versions";
import type { Runner } from "./migrations.ts";

export function currentVersion(root: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) return null;
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function latestTag(tags: Tuple<string>, prerelease: boolean): string | null {
  const versions = tags
    .map((tag) => ({ tag, version: /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1] }))
    .filter((entry): entry is { tag: string; version: string } => entry.version !== undefined)
    .filter((entry) => prerelease || !entry.version.includes("-"));
  versions.sort((a, b) => compareSemver(b.version, a.version));
  return versions[0]?.tag ?? null;
}

function tagsFrom(listing: string): string[] {
  return listing
    .split("\n")
    .map((line) => /refs\/tags\/(v\S+)$/.exec(line.trim())?.[1] ?? line.trim())
    .filter((tag) => tag.startsWith("v"));
}

export function newerRelease(
  root: string,
  run: Runner,
): { current: string; latest: string } | null {
  const current = currentVersion(root);
  if (!current) return null;
  const repo = upstream ? parseRepository(upstream) : null;
  const sources = [
    ["ls-remote", "--tags", "--refs", "upstream"],
    ...(repo ? [["ls-remote", "--tags", "--refs", `${repo.url}.git`]] : []),
    ["tag", "--list", "v*"],
  ];
  for (const source of sources) {
    const listed = run("git", ["-C", root, ...source]);
    if (listed.status !== 0) continue;
    const latest = latestTag(tagsFrom(listed.stdout), current.includes("-"));
    if (!latest) continue;
    return compareSemver(latest.slice(1), current) > 0
      ? { current, latest: latest.slice(1) }
      : null;
  }
  return null;
}

/**
 * Asks GitHub (the upstream in bogey.config.ts) for the latest release and the security
 * advisories that affect this checkout's version. Null when update checks are off
 * (`updateCheck: false`, or BOGEY_UPDATE_CHECK=off) or the version can't be read.
 */
export async function releaseCheck(
  root: string,
  fetcher: Fetcher = httpFetcher,
): Promise<ReleaseCheck | null> {
  const current = currentVersion(root);
  if (!current) return null;
  let config: ResolvedConfig;
  try {
    config = loadConfig(process.env, root).config;
  } catch {
    return null;
  }
  if (!updateChecksOn(config, process.env)) return null;
  return checkRelease(current, config.upstream, fetcher);
}

/** One line per advisory that names this version, and one for a newer release. */
export function describeRelease(check: ReleaseCheck): {
  advisories: string[];
  newer: string | null;
} {
  return {
    advisories: check.advisories.map(
      (advisory) =>
        `Bogey ${check.current} is affected by ${advisory.id}${advisory.severity ? ` (${advisory.severity})` : ""}: ${advisory.summary}.${advisory.patched ? ` Fixed in ${advisory.patched}.` : ""} ${advisory.url}`,
    ),
    newer:
      check.newer && check.latest
        ? `Bogey ${check.latest} is out (this is ${check.current})${check.url ? `: ${check.url}` : ""}`
        : null,
  };
}
