import type { Runner } from "./migrations.ts";

export type Assurance = "release" | "provenance" | "none";

export interface Verification {
  assurance: Assurance;
  detail: string;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

const slug = (repo: RepoRef) => `${repo.owner}/${repo.repo}`;

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "no reason given"
  );
}

function hasGh(run: Runner): boolean {
  return run("gh", ["--version"]).status === 0;
}

const NO_GH = "the GitHub CLI (gh) isn't installed or isn't signed in, so nothing was checked";

export function verifyAsset(file: string, tag: string, repo: RepoRef, run: Runner): Verification {
  if (!hasGh(run)) return { assurance: "none", detail: NO_GH };
  const release = run("gh", ["release", "verify-asset", tag, file, "--repo", slug(repo)]);
  if (release.status === 0) {
    return {
      assurance: "release",
      detail: `GitHub's release attestation: this file is an asset of ${slug(repo)} ${tag}`,
    };
  }
  const provenance = run("gh", ["attestation", "verify", file, "--repo", slug(repo)]);
  if (provenance.status === 0) {
    return {
      assurance: "provenance",
      detail: `GitHub's build attestation: a workflow in ${slug(repo)} built this file`,
    };
  }
  return {
    assurance: "none",
    detail: `no attestation checked out (${firstLine(provenance.stderr || release.stderr)})`,
  };
}

export function verifyRelease(tag: string, repo: RepoRef, run: Runner): Verification {
  if (!hasGh(run)) return { assurance: "none", detail: NO_GH };
  const result = run("gh", ["release", "verify", tag, "--repo", slug(repo)]);
  return result.status === 0
    ? {
        assurance: "release",
        detail: `GitHub's release attestation for ${slug(repo)} ${tag} checked out`,
      }
    : { assurance: "none", detail: `no release attestation (${firstLine(result.stderr)})` };
}
