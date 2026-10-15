import { z } from "zod";
import { compareSemver, inVersionRange } from "@bogey/utils/versions";
import { parseRepository } from "./api.ts";
import { fetchLatestVersion, type Fetcher } from "./updates.ts";

export type AdvisorySeverity = "critical" | "high" | "medium" | "low";

/** A published GitHub security advisory that names the running version as affected. */
export interface SecurityAdvisory {
  id: string;
  cve: string | null;
  summary: string;
  severity: AdvisorySeverity | null;
  url: string;
  affected: string;
  patched: string | null;
}

export interface ReleaseCheck {
  current: string;
  latest: string | null;
  newer: boolean;
  url?: string;
  advisories: SecurityAdvisory[];
}

const advisoryList = z.array(
  z.object({
    ghsa_id: z.string(),
    cve_id: z.string().nullish(),
    html_url: z.string(),
    summary: z.string(),
    severity: z.enum(["critical", "high", "medium", "low"]).nullish().catch(null),
    withdrawn_at: z.string().nullish(),
    vulnerabilities: z
      .array(
        z.object({
          vulnerable_version_range: z.string().nullish(),
          patched_versions: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
);

/**
 * The repository's published security advisories whose affected range includes `version`.
 * A plain unauthenticated request to GitHub's repository advisories API; a range GitHub
 * holds that can't be read is skipped rather than guessed at.
 */
export async function fetchAdvisories(
  repository: string,
  version: string,
  fetcher: Fetcher,
): Promise<{ advisories: SecurityAdvisory[] } | { error: string }> {
  const parsed = parseRepository(repository);
  if (!parsed) return { error: "unreadable repository" };
  try {
    const response = await fetcher(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/security-advisories?state=published&per_page=100`,
      { headers: { accept: "application/vnd.github+json", "user-agent": "bogey-update-check" } },
    );
    if (!response.ok) {
      return {
        error:
          response.status === 403 || response.status === 429
            ? "GitHub rate limit reached. Try again later."
            : `GitHub answered ${response.status}`,
      };
    }
    const list = advisoryList.safeParse(await response.json());
    if (!list.success) return { error: "GitHub's advisory list wasn't in the expected shape" };
    const advisories: SecurityAdvisory[] = [];
    for (const advisory of list.data) {
      if (advisory.withdrawn_at) continue;
      const hit = (advisory.vulnerabilities ?? []).find(
        (vulnerability) =>
          vulnerability.vulnerable_version_range &&
          inVersionRange(version, vulnerability.vulnerable_version_range) === true,
      );
      if (!hit?.vulnerable_version_range) continue;
      advisories.push({
        id: advisory.ghsa_id,
        cve: advisory.cve_id ?? null,
        summary: advisory.summary,
        severity: advisory.severity ?? null,
        url: advisory.html_url,
        affected: hit.vulnerable_version_range,
        patched: hit.patched_versions ?? null,
      });
    }
    return { advisories };
  } catch (error) {
    return { error: `couldn't reach GitHub (${String(error)})` };
  }
}

/** The newest release of `repository` and any published advisory that affects `current`. */
export async function checkRelease(
  current: string,
  repository: string,
  fetcher: Fetcher,
): Promise<ReleaseCheck> {
  const [latest, security] = await Promise.all([
    fetchLatestVersion(
      { key: "bogey", name: "Bogey", version: current, source: { repository } },
      fetcher,
    ),
    fetchAdvisories(repository, current, fetcher),
  ]);
  const advisories = "error" in security ? [] : security.advisories;
  if ("error" in latest) return { current, latest: null, newer: false, advisories };
  return {
    current,
    latest: latest.version,
    newer: compareSemver(latest.version, current) > 0,
    url: latest.url,
    advisories,
  };
}
