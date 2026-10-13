import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstream } from "@bogey/config";
import { parseRepository } from "@bogey/plugins/api";
import { compareSemver, latestTag } from "../commands/upgrade.ts";
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
