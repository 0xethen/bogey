import { busy } from "../lib/activity.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import { databaseUrl } from "../lib/credentials.ts";
import { spawnRunner, type Runner } from "../lib/migrations.ts";
import { parseFlags } from "../lib/flags.ts";
import { runBackup } from "./backup.ts";
import { runDb } from "./db.ts";
import { runPlugins } from "./plugins.ts";
import { runDoctor } from "./doctor.ts";
import { runEmail } from "./email.ts";
import { runThemes } from "./themes.ts";
import { parseRepository } from "@bogey/plugins/api";
import { upstream } from "@bogey/config";
import { verifyRelease } from "../lib/attestation.ts";
import { latestTag } from "../lib/release-status.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey upgrade [--to <tag> | --pre | --branch <name>] [--remote upstream]
              [--db-url <postgres url>] [--skip-backup] [--require-verified] [--dry-run]

Brings this fork up to date with Bogey, in order:

  1. checks the working tree is clean
  2. backs up Storage, and the database's data with a database URL (bogey backup)
  3. merges the latest release tag of <remote> (--to <tag> for a specific one,
     --pre to allow prereleases, --branch <name> to follow a branch instead);
     on conflicts it stops and says how to finish. For a tag it asks GitHub (gh release
     verify) whether the release is attested and says so; --require-verified refuses an
     unattested one
  4. vp install
  5. applies pending migrations with a database URL (bogey db migrate, then
     bogey plugins migrate), or says how
  6. regenerates the theme list, email templates and setting defaults
  7. bogey doctor
  8. prints the CHANGELOG entries that came in

The database URL is --db-url, else DATABASE_URL from the environment or .env.

After resolving a merge and committing it, run it again to continue. --dry-run
prints the steps without doing anything.`;

interface Step {
  title: string;
  run: () => Promise<{ ok: boolean; output: string }>;
}

function result(status: number | null, stdout: string, stderr: string) {
  return {
    ok: status === 0,
    output: [stdout, stderr]
      .filter((text) => text.trim())
      .join("\n")
      .trim(),
  };
}

export function addedChangelog(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n")
    .trim();
}

export async function runUpgrade(
  cwd: string,
  args: string[],
  run: Runner = spawnRunner,
): Promise<CliResult> {
  const root = findRepoRoot(cwd);
  const flags = parseFlags(args);
  const remote = typeof flags.remote === "string" ? flags.remote : "upstream";
  const branch = typeof flags.branch === "string" ? flags.branch : null;
  const to = typeof flags.to === "string" ? flags.to : null;
  const dbUrl = databaseUrl(root, flags["db-url"]);
  const git = (...gitArgs: string[]) => run("git", ["-C", root, ...gitArgs]);

  if (existsSync(join(root, ".git", "MERGE_HEAD"))) {
    return {
      exitCode: 1,
      output:
        "A merge is in progress. Resolve the conflicts, `git commit`, then run bogey upgrade again.",
    };
  }

  const before = git("rev-parse", "HEAD").stdout.trim();

  const steps: Step[] = [
    {
      title: "Working tree is clean",
      run: async () => {
        const status = git("status", "--porcelain");
        if (status.status !== 0) return result(status.status, status.stdout, status.stderr);
        return status.stdout.trim()
          ? { ok: false, output: `Commit or stash these first:\n${status.stdout.trimEnd()}` }
          : { ok: true, output: "" };
      },
    },
    {
      title: dbUrl ? "Back up Storage and the database" : "Back up Storage",
      run: async () => {
        if (flags["skip-backup"]) return { ok: true, output: "Skipped (--skip-backup)." };
        const backup = await runBackup(root, dbUrl ? ["--db-url", dbUrl] : []);
        return { ok: backup.exitCode === 0, output: backup.output };
      },
    },
    {
      title: branch
        ? `Merge ${remote}/${branch}`
        : to
          ? `Merge ${remote}'s ${to}`
          : `Merge the latest release of ${remote}`,
      run: async () => {
        const notes: string[] = [];
        const fetched = branch ? git("fetch", remote, branch) : git("fetch", remote, "--tags");
        if (fetched.status !== 0) {
          return {
            ok: false,
            output: `${fetched.stderr.trim()}\nAdd the remote first: git remote add ${remote} https://github.com/0xethen/bogey.git`,
          };
        }
        let ref = `${remote}/${branch}`;
        if (!branch) {
          const tags = git("tag", "--list", "v*").stdout.split("\n").filter(Boolean);
          const tag = to ?? latestTag(tags, flags.pre === true);
          if (!tag || !tags.includes(tag)) {
            return {
              ok: false,
              output: to
                ? `${remote} has no tag ${to}.`
                : `${remote} has no releases yet. --branch main follows its development instead.`,
            };
          }
          ref = `refs/tags/${tag}`;
          const repo = parseRepository(upstream);
          if (repo) {
            const verified = verifyRelease(tag, { owner: repo.owner, repo: repo.repo }, run);
            if (verified.assurance === "none" && flags["require-verified"] === true) {
              return {
                ok: false,
                output: `${tag} isn't verified, and --require-verified is on: ${verified.detail}`,
              };
            }
            notes.push(
              verified.assurance === "none"
                ? `Not verified: ${verified.detail}.`
                : `${verified.detail}.`,
            );
          }
        }
        const merged = git("merge", "--no-edit", ref);
        if (merged.status === 0) return result(0, [...notes, merged.stdout].join("\n"), "");
        const conflicts = git("diff", "--name-only", "--diff-filter=U").stdout.trim();
        return {
          ok: false,
          output: [
            ...notes,
            conflicts
              ? `The merge stopped on conflicts in:\n${conflicts}\nResolve them, git commit, then run bogey upgrade again.`
              : merged.stderr.trim(),
          ].join("\n"),
        };
      },
    },
    {
      title: "Install dependencies",
      run: async () => {
        const installed = run("vp", ["install"]);
        return result(installed.status, "", installed.status === 0 ? "" : installed.stderr);
      },
    },
    {
      title: "Apply migrations",
      run: async () => {
        if (!dbUrl) {
          return {
            ok: true,
            output:
              "No DATABASE_URL: apply them with `bogey db migrate --db-url ...` or `supabase db push` before starting the new app.",
          };
        }
        const migrated = runDb(root, ["migrate", "--db-url", dbUrl], () => {}, run);
        if (migrated.exitCode !== 0) return { ok: false, output: migrated.output };
        const plugins = await runPlugins(root, ["migrate", "--db-url", dbUrl], run);
        return {
          ok: plugins.exitCode === 0,
          output: [migrated.output, plugins.output].join("\n"),
        };
      },
    },
    {
      title: "Regenerate generated files",
      run: async () => {
        const themes = runThemes(root, []);
        const email = runEmail(root, ["templates"]);
        const baseline = runDb(root, ["baseline", "--check"]);
        return {
          ok: themes.exitCode === 0 && email.exitCode === 0,
          output: [themes.output, email.output, baseline.exitCode === 0 ? "" : baseline.output]
            .filter(Boolean)
            .join("\n"),
        };
      },
    },
    {
      title: "bogey doctor",
      run: async () => {
        const doctor = await runDoctor(root);
        return { ok: doctor.exitCode === 0, output: doctor.output };
      },
    },
  ];

  if (flags["dry-run"]) {
    return {
      exitCode: 0,
      output: [
        "bogey upgrade would:",
        ...steps.map((step, index) => `  ${index + 1}. ${step.title}`),
        `  ${steps.length + 1}. Print what CHANGELOG.md gained`,
      ].join("\n"),
    };
  }

  const log: string[] = [];
  for (const [index, step] of steps.entries()) {
    const outcome = await busy(`${index + 1}/${steps.length}  ${step.title}`, () => step.run());
    log.push(`${outcome.ok ? "✓" : "✗"} ${index + 1}. ${step.title}`);
    if (outcome.output) log.push(outcome.output.replace(/^/gm, "    "));
    if (!outcome.ok) return { exitCode: 1, output: log.join("\n") };
  }

  const changes = addedChangelog(git("diff", `${before}..HEAD`, "--", "CHANGELOG.md").stdout);
  log.push("", changes ? `What changed:\n${changes}` : "CHANGELOG.md has nothing new.");
  return { exitCode: 0, output: log.join("\n") };
}
