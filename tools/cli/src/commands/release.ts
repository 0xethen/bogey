import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareSemver } from "@bogey/utils/versions";
import { findRepoRoot } from "../lib/repo-root.ts";
import {
  releasedPath,
  releasedVersion,
  spawnRunner,
  type ProcessResult,
  type Runner,
} from "../lib/migrations.ts";
import type { Choice, Prompter } from "../lib/prompt.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey release [patch | minor | major | alpha | beta | rc | pre | <version>] [--pre <id>]
              [--push] [--skip-checks] [--no-freeze] [--dry-run]
bogey release check <tag>
bogey release sync <tag> [--yes]
bogey release undo

Releases Bogey from main, in order:

  1. checks the working tree is clean, you're on main, and main isn't behind origin
  2. checks CHANGELOG.md's Unreleased section has something in it, and an "Upgrade notes"
     section when the database (supabase/) or the plugin API changed since the last tag
  3. runs vp check, the tests, and the baseline and docs checks (--skip-checks skips them)
  4. sets package.json's version, turns Unreleased into "## <version> (<date>)"
     under a fresh Unreleased, and on the first non-prerelease freezes the
     baseline (bogey db freeze; --no-freeze skips it)
  5. commits "[release] Bogey v<version>" and tags it v<version>
  6. pushes main and the tag to origin with --push, or asks; the tag starts
     .github/workflows/release.yml, which publishes the image and the GitHub release

Run again while the last release is committed and tagged but not pushed, it offers to push it
or undo it instead of starting another (--push pushes it). \`bogey release undo\` deletes that
tag and the release commit, keeping any uncommitted changes; it refuses once the tag is on origin.

patch, minor and major bump package.json's version; --pre makes it a prerelease
(minor --pre beta: 2.2.0 → 2.3.0-beta.0). From a prerelease, alpha, beta and rc
move on to that stage (2.3.0-alpha.2 → 2.3.0-beta.0), pre counts up the one it's in
(2.3.0-beta.0 → 2.3.0-beta.1), and the bump that started it releases it (minor:
2.3.0). A version always has to come after the current one. The stable release
takes its prereleases' CHANGELOG.md sections into its own, so its notes cover
everything since the last stable release.

Without a version it asks: patch, minor, major, a prerelease (which version, then
which stage), or another version; from a prerelease, the next one, the later stages
or the release.

\`bogey release check <tag>\` checks a tag is releasable: its package.json
version and CHANGELOG.md section match (with Upgrade notes where the rule above asks). The pre-push hook and the release
workflow run it, so a mismatched tag never reaches GitHub.

\`bogey release sync <tag>\` compares the GitHub release's notes with that version's
CHANGELOG.md section (the local file is the source of truth) and, when they differ,
shows the difference and asks before overwriting them (--yes overwrites without asking).
It needs the gh CLI, signed in.`;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Prerelease stages, in the order a version goes through them. */
export const STAGES = ["alpha", "beta", "rc"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_HINTS: Record<Stage, string> = {
  alpha: "early: still changing, for trying out",
  beta: "feature-complete, being tested",
  rc: "release candidate: ships as is unless something breaks",
};

function isStage(value: string): value is Stage {
  return STAGES.some((stage) => stage === value);
}

/** A prerelease's identifier without its number: "beta" for 2.3.0-beta.1. */
function prereleaseId(prerelease: string): string {
  const parts = prerelease.split(".");
  return /^\d+$/.test(parts.at(-1) ?? "") ? parts.slice(0, -1).join(".") : prerelease;
}

function bumped(current: string, bump: string, pre: string | null): string | null {
  const match = SEMVER.exec(current);
  if (!match) return null;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const prerelease = match[4];
  const id = isStage(bump) ? bump : pre;
  if (bump === "pre" || isStage(bump)) {
    if (!prerelease) return null;
    const core = `${major}.${minor}.${patch}`;
    if (id && id !== prereleaseId(prerelease)) return `${core}-${id}.0`;
    const parts = prerelease.split(".");
    const last = parts.at(-1) ?? "";
    if (/^\d+$/.test(last)) parts[parts.length - 1] = String(Number(last) + 1);
    else parts.push("0");
    return `${core}-${parts.join(".")}`;
  }
  // from a prerelease, a bump its version already makes finishes it (2.3.0-beta.1, minor: 2.3.0)
  const core =
    bump === "major"
      ? prerelease && minor === 0 && patch === 0
        ? `${major}.0.0`
        : `${major + 1}.0.0`
      : bump === "minor"
        ? prerelease && patch === 0
          ? `${major}.${minor}.0`
          : `${major}.${minor + 1}.0`
        : bump === "patch"
          ? prerelease
            ? `${major}.${minor}.${patch}`
            : `${major}.${minor}.${patch + 1}`
          : null;
  if (!core) return null;
  return id ? `${core}-${id}.0` : core;
}

/** The version a bump makes from `current`, or null when it can't or wouldn't come after it. */
export function nextVersion(current: string, bump: string, pre: string | null): string | null {
  const version = SEMVER.test(bump) ? bump : bumped(current, bump, pre);
  return version && compareSemver(version, current) > 0 ? version : null;
}

const UNRELEASED = /^## Unreleased[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m;

export function unreleasedNotes(changelog: string): string {
  return UNRELEASED.exec(changelog)?.[1]?.trim() ?? "";
}

function section(version: string): RegExp {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^## ${escaped}( [^\\n]*)?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
}

export function changelogSection(changelog: string, version: string): string {
  return section(version).exec(changelog)?.[2]?.trim() ?? "";
}

/** The prereleases of `version` CHANGELOG.md has sections for, newest (topmost) first. */
export function prereleaseSections(changelog: string, version: string): string[] {
  return [...changelog.matchAll(/^## (\d+\.\d+\.\d+-[0-9A-Za-z.-]+)/gm)]
    .map((match) => match[1] ?? "")
    .filter((found) => found.startsWith(`${version}-`));
}

/** Notes put together into one, each `### ` heading (Upgrade notes, Security) once. */
export function foldNotes(bodies: Tuple<string>): string {
  const sections = new Map<string, string[]>([["", []]]);
  for (const body of bodies) {
    let heading = "";
    const chunks = new Map<string, string[]>();
    for (const line of body.split("\n")) {
      if (line.startsWith("### ")) heading = line.trim();
      else chunks.set(heading, [...(chunks.get(heading) ?? []), line]);
    }
    for (const [name, lines] of chunks) {
      const text = lines.join("\n").trim();
      if (text) sections.set(name, [...(sections.get(name) ?? []), text]);
    }
  }
  return [...sections]
    .filter(([, chunks]) => chunks.length > 0)
    .map(([name, chunks]) => (name ? `${name}\n\n${chunks.join("\n")}` : chunks.join("\n")))
    .join("\n\n");
}

/**
 * Turns Unreleased into "## <version> (<date>)" under a fresh Unreleased. A stable version
 * also takes in its prereleases' sections (2.3.0 gets 2.3.0-beta.1's and 2.3.0-alpha.0's
 * entries), so its notes say everything since the last stable release.
 */
export function stampChangelog(changelog: string, version: string, date: string): string {
  const folded = version.includes("-") ? [] : prereleaseSections(changelog, version);
  if (folded.length === 0) {
    return changelog.replace(/^## Unreleased[ \t]*$/m, `## Unreleased\n\n## ${version} (${date})`);
  }
  const notes = foldNotes([
    unreleasedNotes(changelog),
    ...folded.map((found) => changelogSection(changelog, found)),
  ]);
  const rest = folded.reduce((text, found) => text.replace(section(found), ""), changelog);
  return rest
    .replace(UNRELEASED, `## Unreleased\n\n## ${version} (${date})\n\n${notes}\n\n`)
    .replace(/\n+$/, "\n");
}

function normalizeNotes(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function notesDrift(local: string, remote: string): string | null {
  const want = normalizeNotes(local);
  const have = normalizeNotes(remote);
  if (want === have) return null;
  const wantLines = want.split("\n");
  const haveLines = have.split("\n");
  const removed = haveLines.filter((line) => !wantLines.includes(line));
  const added = wantLines.filter((line) => !haveLines.includes(line));
  return [...removed.map((line) => `- ${line}`), ...added.map((line) => `+ ${line}`)].join("\n");
}

async function syncNotes(
  root: string,
  tag: string,
  yes: boolean,
  prompter: Prompter | null,
  run: Runner,
): Promise<CliResult> {
  const version = /^v(.+)$/.exec(tag)?.[1];
  if (!version || !SEMVER.test(version)) {
    return { exitCode: 1, output: `bogey release: ${tag} isn't v<major>.<minor>.<patch>.` };
  }
  const local = changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf-8"), version);
  if (!local) {
    return {
      exitCode: 1,
      output: `bogey release: CHANGELOG.md has no entries under "## ${version}".`,
    };
  }
  const view = run("gh", ["release", "view", tag, "--json", "body", "--jq", ".body"]);
  if (view.status !== 0) {
    return {
      exitCode: 1,
      output: `bogey release: couldn't read the ${tag} release (is gh installed and signed in, and is it published?)\n${view.stderr.trim()}`,
    };
  }
  const drift = notesDrift(local, view.stdout);
  if (!drift) return { exitCode: 0, output: `${tag}'s GitHub notes match CHANGELOG.md.` };
  const proceed =
    yes ||
    (prompter !== null &&
      (await prompter.confirm({
        message: `${tag}'s GitHub notes differ from CHANGELOG.md:\n${drift}\nOverwrite them?`,
      })));
  if (!proceed) {
    return {
      exitCode: 0,
      output: `${tag}'s GitHub notes differ from CHANGELOG.md:\n${drift}\n\nLeft as they were.`,
    };
  }
  const edit = run("gh", ["release", "edit", tag, "--notes-file", "-"], `${local}\n`);
  if (edit.status !== 0) {
    return { exitCode: 1, output: `bogey release: couldn't update ${tag}\n${edit.stderr.trim()}` };
  }
  return { exitCode: 0, output: `✓ ${tag}'s GitHub notes now match CHANGELOG.md.` };
}

const UPGRADE_NOTES = /upgrade notes/i;

export function touchesUpgradeSurface(changedFiles: readonly string[], apiDiff: string): boolean {
  const database = changedFiles.some(
    (file) =>
      file.startsWith("supabase/") &&
      !file.startsWith("supabase/tests/") &&
      file !== "supabase/RELEASED",
  );
  return database || /^[+-].*\b(PLUGIN_API|SUPPORTED_PLUGIN_APIS)\b/m.test(apiDiff);
}

export function upgradeNotesProblem(
  root: string,
  since: string,
  ref: string,
  notes: string,
  run: Runner,
): string | null {
  const previous = run("git", [
    "-C",
    root,
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v*",
    since,
  ]);
  const from = previous.stdout.trim();
  if (previous.status !== 0 || !from) return null;
  const files = run("git", ["-C", root, "diff", "--name-only", from, ref, "--", "supabase"]);
  const api = run("git", [
    "-C",
    root,
    "diff",
    "-U0",
    from,
    ref,
    "--",
    "packages/plugins/src/api.ts",
  ]);
  if (files.status !== 0 || api.status !== 0) return null;
  const changed = files.stdout.split("\n").filter(Boolean);
  if (!touchesUpgradeSurface(changed, api.stdout) || UPGRADE_NOTES.test(notes)) return null;
  return `the database or the plugin API changed since ${from}, so the notes need an "Upgrade notes" section saying what an upgrade must do.`;
}

function readVersion(packageJson: string): string | null {
  return /"version"\s*:\s*"([^"]+)"/.exec(packageJson)?.[1] ?? null;
}

export function releaseProblems(root: string, tag: string, ref: string, run: Runner): string[] {
  const version = /^v(.+)$/.exec(tag)?.[1];
  if (!version || !SEMVER.test(version)) return [`${tag} isn't v<major>.<minor>.<patch>.`];
  const show = (path: string) => run("git", ["-C", root, "show", `${ref}:${path}`]);
  const problems: string[] = [];

  const packageJson = show("package.json");
  const found = packageJson.status === 0 ? readVersion(packageJson.stdout) : null;
  if (found !== version) {
    problems.push(`package.json's version is ${found ?? "missing"}, not ${version}.`);
  }
  const changelog = show("CHANGELOG.md");
  if (changelog.status !== 0 || !changelogSection(changelog.stdout, version)) {
    problems.push(`CHANGELOG.md has no entries under "## ${version}".`);
  }
  const upgrade = upgradeNotesProblem(
    root,
    `${ref}^`,
    ref,
    changelog.status === 0 ? changelogSection(changelog.stdout, version) : "",
    run,
  );
  if (upgrade) problems.push(upgrade);
  if (!version.includes("-") && show("supabase/RELEASED").status !== 0) {
    problems.push(
      "supabase/RELEASED is missing: a release freezes the baseline (bogey db freeze).",
    );
  }
  return problems;
}

/** The release HEAD is, while its tag hasn't reached origin; null otherwise. */
export function pendingRelease(git: (...args: string[]) => ProcessResult): string | null {
  const subject = git("log", "-1", "--format=%s").stdout.trim();
  const tag = /^\[release\] Bogey (v\S+)$/.exec(subject)?.[1];
  if (!tag || git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`).status !== 0) return null;
  const remote = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`);
  return remote.status === 0 && remote.stdout.trim() ? null : tag;
}

const KINDS = [
  ["patch", "fixes only, minor enhancements"],
  ["minor", "new features"],
  ["major", "breaking changes"],
] as const;

/** Asks which version to release: a few choices at a time, not every combination at once. */
export async function chooseVersion(
  current: string,
  pre: string | null,
  prompter: Prompter,
): Promise<string> {
  const message = `Release which version? (now ${current})`;
  const other = async () =>
    prompter.text({
      message: "Which version?",
      placeholder: "2.3.0-beta.0",
      validate: (value) =>
        !SEMVER.test(value)
          ? "Write it as <major>.<minor>.<patch>, optionally with -<prerelease>."
          : compareSemver(value, current) <= 0
            ? `It has to come after ${current}.`
            : null,
    });
  const choices = (entries: Tuple<readonly [string, string]>): Array<Choice<string>> => {
    const found = new Map<string, Choice<string>>();
    for (const [bump, hint] of entries) {
      const version = nextVersion(current, bump, pre);
      if (version && !found.has(version))
        found.set(version, { value: version, label: `v${version}`, hint });
    }
    return [...found.values()];
  };
  const otherChoice: Choice<string> = { value: "other", label: "Another version..." };

  const prerelease = SEMVER.exec(current)?.[4];
  if (pre || prerelease) {
    // the next prerelease, the stages after this one (earlier ones aren't after it), the release
    const id = pre ?? prereleaseId(prerelease ?? "");
    const picked = await prompter.select({
      message,
      options: [
        ...choices([
          ["pre", `next ${id}`],
          ...STAGES.map((stage) => [stage, `move on to ${stage}: ${STAGE_HINTS[stage]}`] as const),
          ...(pre ? KINDS : [["patch", "the release itself"] as const]),
        ]),
        otherChoice,
      ],
    });
    return picked === "other" ? other() : picked;
  }

  const picked = await prompter.select({
    message,
    options: [
      ...choices(KINDS),
      { value: "pre", label: "A prerelease...", hint: "alpha, beta, or rc" },
      otherChoice,
    ],
  });
  if (picked === "other") return other();
  if (picked !== "pre") return picked;
  const kind = await prompter.select({
    message: "A prerelease of which version?",
    options: KINDS.flatMap(([bump, hint]) => {
      const version = nextVersion(current, bump, null);
      return version ? [{ value: bump, label: `v${version}`, hint }] : [];
    }),
    initial: "minor",
  });
  return prompter.select({
    message: "Which stage?",
    options: STAGES.flatMap((stage) => {
      const version = nextVersion(current, kind, stage);
      return version ? [{ value: version, label: `v${version}`, hint: STAGE_HINTS[stage] }] : [];
    }),
  });
}

type Outcome = { ok: true; output: string } | { ok: false; output: string };

function step(result: { status: number | null; stdout: string; stderr: string }): Outcome {
  const output = [result.stdout, result.stderr].join("\n").trim();
  return result.status === 0 ? { ok: true, output } : { ok: false, output };
}

export async function runRelease(
  cwd: string,
  args: string[],
  prompter: Prompter | null,
  run: Runner = spawnRunner,
  now: () => Date = () => new Date(),
): Promise<CliResult> {
  const root = findRepoRoot(cwd);
  const flags = parseFlags(args);
  const git = (...gitArgs: string[]) => run("git", ["-C", root, ...gitArgs]);
  const positional = args.filter(
    (arg, index) => !arg.startsWith("--") && !(args[index - 1] === "--pre"),
  );

  if (positional[0] === "check") {
    const tag = positional[1];
    if (!tag) return { exitCode: 1, output: "bogey release check <tag>" };
    const problems = releaseProblems(root, tag, tag, run);
    return problems.length
      ? {
          exitCode: 1,
          output: `bogey release: ${tag} can't be released:\n  ✗ ${problems.join("\n  ✗ ")}`,
        }
      : { exitCode: 0, output: `${tag} is ready to release.` };
  }

  if (positional[0] === "sync") {
    const tag = positional[1];
    if (!tag) return { exitCode: 1, output: "bogey release sync <tag> [--yes]" };
    return syncNotes(root, tag, flags.yes === true, prompter, run);
  }

  const undo = (tag: string): CliResult => {
    const deleted = step(git("tag", "-d", tag));
    if (!deleted.ok) return { exitCode: 1, output: `✗ git tag -d ${tag}\n${deleted.output}` };
    // --keep, not --hard: changes made since the release stay
    const reset = step(git("reset", "--keep", "HEAD~1"));
    if (!reset.ok) return { exitCode: 1, output: `✗ git reset --keep HEAD~1\n${reset.output}` };
    return { exitCode: 0, output: `✓ undid ${tag}: its tag and release commit are gone` };
  };
  const publish = (tag: string, log: string[]): CliResult => {
    const pushed = step(git("push", "--atomic", "origin", "main", tag));
    if (!pushed.ok)
      return { exitCode: 1, output: [...log, `✗ git push\n${pushed.output}`].join("\n") };
    const origin = /github\.com[:/]([^/]+\/[^/.]+)/.exec(
      git("remote", "get-url", "origin").stdout,
    )?.[1];
    log.push(
      "✓ pushed: GitHub Actions is building the release",
      ...(origin ? [`  https://github.com/${origin}/actions/workflows/release.yml`] : []),
    );
    return { exitCode: 0, output: log.join("\n") };
  };

  if (positional[0] === "undo") {
    const tag = pendingRelease(git);
    return tag
      ? undo(tag)
      : {
          exitCode: 1,
          output:
            "bogey release undo: HEAD isn't a release that's still only here (committed and tagged, not pushed).",
        };
  }

  // a release that was committed and tagged but not pushed is finished first, not released past
  const pending = flags["dry-run"] ? null : pendingRelease(git);
  if (pending) {
    const choice =
      flags.push === true
        ? "push"
        : prompter
          ? await prompter.select({
              message: `${pending} is committed and tagged here but not pushed.`,
              options: [
                { value: "push", label: `Push main and ${pending} to origin` },
                { value: "undo", label: `Undo ${pending}`, hint: "delete its tag and commit" },
                { value: "leave", label: "Leave it" },
              ],
            })
          : "leave";
    if (choice === "push") return publish(pending, []);
    if (choice === "undo") return undo(pending);
    return {
      exitCode: 1,
      output: `${pending} is committed and tagged but not pushed.\nTo publish: git push --atomic origin main ${pending}\nTo undo: vpr bogey release undo`,
    };
  }

  const packagePath = join(root, "package.json");
  const changelogPath = join(root, "CHANGELOG.md");
  const packageJson = readFileSync(packagePath, "utf-8");
  const changelog = readFileSync(changelogPath, "utf-8");
  const current = readVersion(packageJson);
  if (!current) return { exitCode: 1, output: "bogey release: package.json has no version." };

  const pre = typeof flags.pre === "string" ? flags.pre : null;
  const bump = positional[0] ?? (prompter ? await chooseVersion(current, pre, prompter) : null);
  if (!bump) return { exitCode: 1, output: USAGE };
  const version = nextVersion(current, bump, pre);
  if (!version) {
    return {
      exitCode: 1,
      output: SEMVER.test(bump)
        ? `bogey release: ${bump} doesn't come after ${current}.`
        : isStage(bump) && !current.includes("-")
          ? `bogey release: ${current} isn't a prerelease. Start one with minor --pre ${bump} (or patch or major).`
          : `bogey release: can't ${bump} from ${current}. Pass patch, minor, major, alpha, beta, rc, pre or a version.`,
    };
  }
  const tag = `v${version}`;
  const freeze = !version.includes("-") && !releasedVersion(root) && !flags["no-freeze"];
  const stamped = stampChangelog(changelog, version, now().toISOString().slice(0, 10));
  const folded = version.includes("-") ? [] : prereleaseSections(changelog, version);
  const notes = changelogSection(stamped, version);

  const checks: Array<[string, string[]]> = flags["skip-checks"]
    ? []
    : [
        ["vp", ["check"]],
        ["vp", ["run", "-r", "test"]],
        ["node", [join(root, "tools/cli/src/bin.ts"), "db", "baseline", "--check"]],
        ["node", [join(root, "tools/cli/src/bin.ts"), "docs", "--check"]],
      ];

  if (flags["dry-run"]) {
    return {
      exitCode: 0,
      output: [
        `bogey release would release ${tag} (now ${current}):`,
        `  1. check the tree is clean, on main, and up to date with origin`,
        `  2. check Unreleased has notes${notes ? "" : " (it's empty: this would stop)"}`,
        `  3. run ${checks.length ? checks.map(([command, rest]) => [command, ...rest.slice(command === "node" ? 1 : 0)].join(" ")).join(", ") : "no checks (--skip-checks)"}`,
        `  4. set package.json to ${version}, stamp CHANGELOG.md${folded.length ? ` (taking in ${folded.join(", ")})` : ""}${freeze ? `, freeze the baseline at ${tag}` : ""}`,
        `  5. commit "[release] Bogey ${tag}" and tag ${tag}`,
        `  6. ${flags.push ? "push" : "ask before pushing"} main and ${tag} to origin`,
      ].join("\n"),
    };
  }

  const log: string[] = [];
  const stop = (output: string): CliResult => ({
    exitCode: 1,
    output: [...log, output].join("\n"),
  });

  const status = git("status", "--porcelain");
  if (status.status !== 0) return stop(status.stderr.trim());
  if (status.stdout.trim()) return stop(`Commit or stash these first:\n${status.stdout.trimEnd()}`);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  if (branch !== "main") return stop(`Releases are cut from main; you're on ${branch}.`);
  if (git("fetch", "origin", "main", "--tags").status === 0) {
    const behind = Number(git("rev-list", "--count", "HEAD..origin/main").stdout.trim() || "0");
    if (behind > 0) return stop(`main is ${behind} commit(s) behind origin: git pull first.`);
  }
  if (git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`).status === 0) {
    return stop(`${tag} already exists.`);
  }
  if (!notes) {
    return stop("CHANGELOG.md's Unreleased section is empty: say what this release changes first.");
  }
  const upgrade = upgradeNotesProblem(root, "HEAD", "HEAD", notes, run);
  if (upgrade) return stop(`CHANGELOG.md: ${upgrade}`);
  log.push(
    `✓ ${tag} from main, with notes${folded.length ? ` (taking in ${folded.join(", ")})` : ""}`,
  );

  for (const [command, rest] of checks) {
    const label = [
      command === "node" ? "bogey" : command,
      ...rest.slice(command === "node" ? 1 : 0),
    ].join(" ");
    const outcome = step(run(command, rest));
    if (!outcome.ok) {
      return { ...stop(`✗ ${label}\n${outcome.output.replace(/^/gm, "    ")}`), hints: false };
    }
    log.push(`✓ ${label}`);
  }

  writeFileSync(packagePath, packageJson.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
  writeFileSync(changelogPath, stamped);
  const files = ["package.json", "CHANGELOG.md"];
  if (freeze) {
    writeFileSync(releasedPath(root), `${tag}\n`);
    files.push("supabase/RELEASED");
  }

  const committed = step(git("add", ...files));
  if (!committed.ok) return stop(committed.output);
  const commit = step(git("commit", "-m", `[release] Bogey ${tag}`));
  if (!commit.ok) return stop(`✗ git commit\n${commit.output}`);
  const tagged = step(git("tag", "-a", tag, "-m", `${tag}\n\n${notes}`));
  if (!tagged.ok) return stop(`✗ git tag\n${tagged.output}`);
  log.push(
    `✓ committed and tagged ${tag}${freeze ? " (baseline frozen: schema changes are migrations now)" : ""}`,
  );

  const push =
    flags.push === true ||
    (prompter !== null && (await prompter.confirm({ message: `Push main and ${tag} to origin?` })));
  if (!push) {
    log.push(
      "",
      `Not pushed. To publish: git push --atomic origin main ${tag}`,
      "To undo: vpr bogey release undo",
    );
    return { exitCode: 0, output: log.join("\n") };
  }
  return publish(tag, log);
}
