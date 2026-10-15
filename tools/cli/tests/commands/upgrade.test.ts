import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import { addedChangelog, runUpgrade } from "../../src/commands/upgrade.ts";
import { latestTag } from "../../src/lib/release-status.ts";
import type { ProcessResult, Runner } from "../../src/lib/migrations.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-upgrade-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(root, ".git"));
});

function fake(responses: Record<string, Partial<ProcessResult>>) {
  const calls: string[] = [];
  const run: Runner = (command, args) => {
    const line = [command, ...args.filter((arg) => arg !== "-C" && arg !== root)].join(" ");
    calls.push(line);
    const match = Object.entries(responses).find(([prefix]) => line.startsWith(prefix));
    return { status: 0, stdout: "", stderr: "", ...match?.[1] };
  };
  return { run, calls };
}

test("dry run lists the steps and runs nothing that changes anything", async () => {
  const { run, calls } = fake({});
  const result = await runUpgrade(root, ["--dry-run"], run);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Merge the latest release of upstream");
  expect(calls.filter((call) => !call.startsWith("git rev-parse"))).toEqual([]);
});

test("a dirty working tree stops it before anything else", async () => {
  const { run, calls } = fake({ "git status": { stdout: " M bogey.config.ts\n" } });
  const result = await runUpgrade(root, [], run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Commit or stash");
  expect(calls.some((call) => call.startsWith("git merge"))).toBe(false);
});

test("merge conflicts stop it with the files to resolve", async () => {
  const { run } = fake({
    "git merge": { status: 1, stderr: "CONFLICT" },
    "git diff --name-only": { stdout: "bogey.config.ts\n" },
  });
  const result = await runUpgrade(root, ["--skip-backup", "--branch", "main"], run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("bogey.config.ts");
  expect(result.output).toContain("run bogey upgrade again");
});

test("a merge in progress has to be finished first", async () => {
  writeFileSync(join(root, ".git", "MERGE_HEAD"), "abc");
  const result = await runUpgrade(root, [], fake({}).run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("merge is in progress");
});

test("addedChangelog keeps only added lines", () => {
  expect(addedChangelog("+++ b/CHANGELOG.md\n+## 1.1.0\n+- New thing\n context\n-old")).toBe(
    "## 1.1.0\n- New thing",
  );
});

test("it merges the newest stable release tag", async () => {
  const { run, calls } = fake({
    "git tag": { stdout: "v1.0.0\nv1.2.0\nv1.10.0\nv2.0.0-rc.1\nnot-a-release\n" },
    "git merge": { status: 1, stderr: "stop" },
  });
  const result = await runUpgrade(root, ["--skip-backup"], run);
  expect(calls).toContain("git fetch upstream --tags");
  expect(calls).toContain("git merge --no-edit refs/tags/v1.10.0");
  expect(result.output).toContain("Merge the latest release of upstream");
});

test("--to merges that tag, and says when it doesn't exist", async () => {
  const tags = {
    "git tag": { stdout: "v1.0.0\nv1.1.0\n" },
    "git merge": { status: 1, stderr: "stop" },
  };
  const ok = fake(tags);
  await runUpgrade(root, ["--skip-backup", "--to", "v1.0.0"], ok.run);
  expect(ok.calls).toContain("git merge --no-edit refs/tags/v1.0.0");
  const missing = await runUpgrade(root, ["--skip-backup", "--to", "v9.9.9"], fake(tags).run);
  expect(missing.exitCode).toBe(1);
  expect(missing.output).toContain("no tag v9.9.9");
});

test("with no releases yet it says so and points at --branch", async () => {
  const result = await runUpgrade(root, ["--skip-backup"], fake({}).run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("--branch main");
});

test("--branch follows a branch as before", async () => {
  const { run, calls } = fake({ "git merge": { status: 1, stderr: "stop" } });
  await runUpgrade(root, ["--skip-backup", "--branch", "main"], run);
  expect(calls).toContain("git fetch upstream main");
  expect(calls).toContain("git merge --no-edit upstream/main");
});

test("latestTag skips prereleases unless asked, and ranks a release above its candidates", () => {
  const tags = ["v1.9.0", "v1.10.0", "v2.0.0-rc.1", "v2.0.0-rc.2", "junk"];
  expect(latestTag(tags, false)).toBe("v1.10.0");
  expect(latestTag(tags, true)).toBe("v2.0.0-rc.2");
  expect(latestTag([...tags, "v2.0.0"], true)).toBe("v2.0.0");
  expect(latestTag([], false)).toBeNull();
});

test("a tag is checked with gh release verify and the result is shown", async () => {
  const { run, calls } = fake({
    "git tag": { stdout: "v1.0.0\n" },
    "git merge": { status: 1, stderr: "stop" },
  });
  await runUpgrade(root, ["--skip-backup"], run);
  expect(calls.some((call) => call.startsWith("gh release verify v1.0.0 --repo "))).toBe(true);
});

test("an unattested release is a warning, and --require-verified makes it a stop", async () => {
  const responses = {
    "git tag": { stdout: "v1.0.0\n" },
    "gh release verify": { status: 1, stderr: "release has no attestation" },
    "git merge": { status: 1, stderr: "stop" },
  };
  const warned = fake(responses);
  const outcome = await runUpgrade(root, ["--skip-backup"], warned.run);
  expect(outcome.output).toContain("Not verified");
  expect(warned.calls).toContain("git merge --no-edit refs/tags/v1.0.0");

  const strict = fake(responses);
  const refused = await runUpgrade(root, ["--skip-backup", "--require-verified"], strict.run);
  expect(refused.exitCode).toBe(1);
  expect(refused.output).toContain("--require-verified");
  expect(strict.calls.some((call) => call.startsWith("git merge"))).toBe(false);
});

test("following a branch isn't checked for attestations", async () => {
  const { run, calls } = fake({ "git merge": { status: 1, stderr: "stop" } });
  await runUpgrade(root, ["--skip-backup", "--branch", "main"], run);
  expect(calls.some((call) => call.startsWith("gh "))).toBe(false);
});
