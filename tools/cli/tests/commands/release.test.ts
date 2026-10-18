import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import {
  changelogSection,
  chooseVersion,
  foldNotes,
  nextVersion,
  notesDrift,
  runRelease,
  stampChangelog,
  touchesUpgradeSurface,
  unreleasedNotes,
  upgradeNotesProblem,
} from "../../src/commands/release.ts";
import type { ProcessResult, Runner } from "../../src/lib/migrations.ts";
import { scripted } from "../support/prompter.ts";

const CHANGELOG = `# Changelog

Intro.

## Unreleased

- Repair.

## 0.1.0 (2026-09-01)

- First.
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-release-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(root, "supabase"));
  writeFileSync(join(root, "package.json"), `{\n  "name": "bogey",\n  "version": "0.1.0"\n}\n`);
  writeFileSync(join(root, "CHANGELOG.md"), CHANGELOG);
});

function fake(responses: Record<string, Partial<ProcessResult>> = {}) {
  const calls: string[] = [];
  const run: Runner = (command, args) => {
    const line = [command, ...args.filter((arg) => arg !== "-C" && arg !== root)].join(" ");
    calls.push(line);
    const match = Object.entries(responses).find(([prefix]) => line.startsWith(prefix));
    const fallback = line.startsWith("git rev-parse --abbrev-ref")
      ? { stdout: "main\n" }
      : line.startsWith("git rev-parse --verify")
        ? { status: 1 }
        : {};
    return { status: 0, stdout: "", stderr: "", ...fallback, ...match?.[1] };
  };
  return { run, calls };
}

const at = () => new Date("2026-10-08T12:00:00Z");

test("versions bump by kind, and prereleases count up", () => {
  expect(nextVersion("0.1.0", "patch", null)).toBe("0.1.1");
  expect(nextVersion("0.1.0", "minor", null)).toBe("0.2.0");
  expect(nextVersion("0.1.0", "major", null)).toBe("1.0.0");
  expect(nextVersion("0.1.0", "minor", "beta")).toBe("0.2.0-beta.0");
  expect(nextVersion("0.2.0-beta.0", "pre", null)).toBe("0.2.0-beta.1");
  expect(nextVersion("0.2.0-beta.3", "patch", null)).toBe("0.2.0");
  expect(nextVersion("0.1.0", "pre", null)).toBeNull();
  expect(nextVersion("0.1.0", "2.0.0-rc.1", null)).toBe("2.0.0-rc.1");
  expect(nextVersion("0.1.0", "sideways", null)).toBeNull();
});

test("prereleases move through alpha, beta and rc, and are finished by the bump that made them", () => {
  expect(nextVersion("2.3.0-alpha.2", "beta", null)).toBe("2.3.0-beta.0");
  expect(nextVersion("2.3.0-alpha.2", "alpha", null)).toBe("2.3.0-alpha.3");
  expect(nextVersion("2.3.0-alpha.2", "pre", "rc")).toBe("2.3.0-rc.0");
  expect(nextVersion("2.3.0-beta.1", "alpha", null)).toBeNull();
  expect(nextVersion("2.2.0", "beta", null)).toBeNull();
  expect(nextVersion("2.3.0-beta.1", "minor", null)).toBe("2.3.0");
  expect(nextVersion("2.3.0-beta.1", "minor", "rc")).toBe("2.3.0-rc.0");
  expect(nextVersion("2.3.1-beta.1", "minor", null)).toBe("2.4.0");
  expect(nextVersion("3.0.0-rc.0", "major", null)).toBe("3.0.0");
  expect(nextVersion("2.2.0", "2.1.9", null)).toBeNull();
});

test("a stable release takes in its prereleases' sections", () => {
  const changelog = `# Changelog

## Unreleased

- Fix.

## 0.2.0-beta.0 (2026-10-02)

- Beta.

### Upgrade notes

- Run the migration.

## 0.2.0-alpha.0 (2026-10-01)

- Alpha.

## 0.1.0 (2026-09-01)

- First.
`;
  const stamped = stampChangelog(changelog, "0.2.0", "2026-10-08");
  expect(changelogSection(stamped, "0.2.0")).toBe(
    "- Fix.\n- Beta.\n- Alpha.\n\n### Upgrade notes\n\n- Run the migration.",
  );
  expect(stamped).not.toContain("0.2.0-");
  expect(changelogSection(stamped, "0.1.0")).toBe("- First.");
  expect(unreleasedNotes(stamped)).toBe("");
  expect(stampChangelog(changelog, "0.2.0-beta.1", "2026-10-08")).toContain("## 0.2.0-beta.0");
  expect(foldNotes(["### Security\n\n- A.", "- B.\n\n### Security\n\n- C."])).toBe(
    "- B.\n\n### Security\n\n- A.\n- C.",
  );
});

test("a stable release after a beta needs no new entries", async () => {
  writeFileSync(join(root, "package.json"), `{\n  "version": "0.2.0-beta.0"\n}\n`);
  writeFileSync(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n## 0.2.0-beta.0 (2026-10-02)\n\n- Beta.\n",
  );
  const result = await runRelease(root, ["minor", "--skip-checks"], null, fake().run, at);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("taking in 0.2.0-beta.0");
  expect(readFileSync(join(root, "CHANGELOG.md"), "utf-8")).toBe(
    "# Changelog\n\n## Unreleased\n\n## 0.2.0 (2026-10-08)\n\n- Beta.\n",
  );
});

test("asking for a version: a bump, or a prerelease in two short steps", async () => {
  const plain = scripted(["v2.3.0"]);
  expect(await chooseVersion("2.2.0", null, plain.prompter)).toBe("2.3.0");
  const pre = scripted(["pre", "minor", "v2.3.0-beta.0"]);
  expect(await chooseVersion("2.2.0", null, pre.prompter)).toBe("2.3.0-beta.0");
  expect(pre.asked).toEqual([
    "Release which version? (now 2.2.0)",
    "A prerelease of which version?",
    "Which stage?",
  ]);
  const other = scripted(["other", "4.0.0"]);
  expect(await chooseVersion("2.2.0", null, other.prompter)).toBe("4.0.0");
  const flagged = scripted(["v2.3.0-rc.0"]);
  expect(await chooseVersion("2.2.0", "rc", flagged.prompter)).toBe("2.3.0-rc.0");
});

test("asking from a prerelease offers the next one, the later stages and the release", async () => {
  const labels: string[] = [];
  const { prompter } = scripted([]);
  prompter.select = async (question) => {
    labels.push(...question.options.map((option) => option.label));
    const first = question.options[0];
    if (!first) throw new Error("no options");
    return first.value;
  };
  expect(await chooseVersion("2.3.0-beta.1", null, prompter)).toBe("2.3.0-beta.2");
  expect(labels).toEqual(["v2.3.0-beta.2", "v2.3.0-rc.0", "v2.3.0", "Another version..."]);
});

test("the changelog's Unreleased section becomes the release's", () => {
  expect(unreleasedNotes(CHANGELOG)).toBe("- Repair.");
  const stamped = stampChangelog(CHANGELOG, "0.2.0", "2026-10-08");
  expect(stamped).toContain("## Unreleased\n\n## 0.2.0 (2026-10-08)\n\n- Repair.");
  expect(unreleasedNotes(stamped)).toBe("");
  expect(changelogSection(stamped, "0.2.0")).toBe("- Repair.");
  expect(changelogSection(stamped, "0.1.0")).toBe("- First.");
});

test("a release bumps, stamps, freezes, commits, tags and pushes", async () => {
  const { run, calls } = fake();
  const result = await runRelease(root, ["minor", "--push"], null, run, at);
  expect(result.exitCode).toBe(0);
  expect(readFileSync(join(root, "package.json"), "utf-8")).toContain('"version": "0.2.0"');
  expect(readFileSync(join(root, "CHANGELOG.md"), "utf-8")).toContain("## 0.2.0 (2026-10-08)");
  expect(readFileSync(join(root, "supabase", "RELEASED"), "utf-8")).toBe("v0.2.0\n");
  expect(calls).toContain("vp check");
  expect(calls).toContain("git add package.json CHANGELOG.md supabase/RELEASED");
  expect(calls).toContain("git commit -m [release] Bogey v0.2.0");
  expect(calls.some((call) => call.startsWith("git tag -a v0.2.0 -m v0.2.0\n\n- Repair."))).toBe(
    true,
  );
  expect(calls).toContain("git push --atomic origin main v0.2.0");
});

test("a prerelease doesn't freeze the baseline", async () => {
  const { run } = fake();
  await runRelease(root, ["minor", "--pre", "beta", "--skip-checks", "--push"], null, run, at);
  expect(readFileSync(join(root, "package.json"), "utf-8")).toContain('"version": "0.2.0-beta.0"');
  expect(existsSync(join(root, "supabase", "RELEASED"))).toBe(false);
});

test("without --push or a person to ask, it stops before pushing and says how", async () => {
  const { run, calls } = fake();
  const result = await runRelease(root, ["patch", "--skip-checks"], null, run, at);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("git push --atomic origin main v0.1.1");
  expect(calls.some((call) => call.startsWith("git push"))).toBe(false);
});

test("it asks for the version and before pushing", async () => {
  const { prompter, asked } = scripted(["v0.1.1", false]);
  const { run, calls } = fake();
  const result = await runRelease(root, ["--skip-checks"], prompter, run, at);
  expect(result.exitCode).toBe(0);
  expect(asked).toEqual(["Release which version? (now 0.1.0)", "Push main and v0.1.1 to origin?"]);
  expect(calls).toContain("git commit -m [release] Bogey v0.1.1");
  expect(calls.some((call) => call.startsWith("git push"))).toBe(false);
});

test("a failing check stops it before anything changes", async () => {
  const { run, calls } = fake({ "vp check": { status: 1, stderr: "type error" } });
  const result = await runRelease(root, ["patch"], null, run, at);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("✗ vp check");
  expect(result.hints).toBe(false);
  expect(readFileSync(join(root, "package.json"), "utf-8")).toContain('"version": "0.1.0"');
  expect(calls.some((call) => call.startsWith("git commit"))).toBe(false);
});

test("it refuses a dirty tree, another branch, an empty changelog and an existing tag", async () => {
  const dirty = await runRelease(
    root,
    ["patch"],
    null,
    fake({ "git status": { stdout: " M x\n" } }).run,
  );
  expect(dirty.output).toContain("Commit or stash");
  const branch = await runRelease(
    root,
    ["patch"],
    null,
    fake({ "git rev-parse --abbrev-ref": { stdout: "feature\n" } }).run,
  );
  expect(branch.output).toContain("you're on feature");
  const tagged = await runRelease(
    root,
    ["patch"],
    null,
    fake({ "git rev-parse --verify": { status: 0 } }).run,
  );
  expect(tagged.output).toContain("v0.1.1 already exists");
  writeFileSync(join(root, "CHANGELOG.md"), stampChangelog(CHANGELOG, "0.1.1", "2026-10-08"));
  const empty = await runRelease(root, ["patch"], null, fake().run);
  expect(empty.output).toContain("Unreleased section is empty");
});

test("a release committed and tagged but not pushed is pushed or undone, not released past", async () => {
  const pending = {
    "git log -1 --format=%s": { stdout: "[release] Bogey v0.1.1\n" },
    "git rev-parse --verify --quiet refs/tags/v0.1.1": { status: 0 },
  };
  const asked = scripted(["push"]);
  const pushed = fake(pending);
  const push = await runRelease(root, [], asked.prompter, pushed.run, at);
  expect(asked.asked).toEqual(["v0.1.1 is committed and tagged here but not pushed."]);
  expect(push.exitCode).toBe(0);
  expect(pushed.calls).toContain("git push --atomic origin main v0.1.1");
  expect(pushed.calls.some((call) => call.startsWith("git commit"))).toBe(false);

  const undone = fake(pending);
  const undo = await runRelease(root, ["undo"], null, undone.run, at);
  expect(undo.exitCode).toBe(0);
  expect(undone.calls).toContain("git tag -d v0.1.1");
  expect(undone.calls).toContain("git reset --keep HEAD~1");

  const alone = await runRelease(root, ["patch"], null, fake(pending).run, at);
  expect(alone.exitCode).toBe(1);
  expect(alone.output).toContain("bogey release undo");
});

test("undo refuses a release that reached origin, and anything that isn't a release", async () => {
  const published = fake({
    "git log -1 --format=%s": { stdout: "[release] Bogey v0.1.1\n" },
    "git rev-parse --verify --quiet refs/tags/v0.1.1": { status: 0 },
    "git ls-remote": { stdout: "abc\trefs/tags/v0.1.1\n" },
  });
  expect((await runRelease(root, ["undo"], null, published.run, at)).exitCode).toBe(1);
  expect(published.calls.some((call) => call.startsWith("git tag -d"))).toBe(false);
  expect((await runRelease(root, ["undo"], null, fake().run, at)).exitCode).toBe(1);
});

test("check compares a tag with its package.json and changelog", async () => {
  const stamped = stampChangelog(CHANGELOG, "0.2.0", "2026-10-08");
  const good = fake({
    "git show v0.2.0:package.json": { stdout: '{ "version": "0.2.0" }' },
    "git show v0.2.0:CHANGELOG.md": { stdout: stamped },
  });
  expect((await runRelease(root, ["check", "v0.2.0"], null, good.run)).exitCode).toBe(0);

  const bad = fake({
    "git show v0.3.0:package.json": { stdout: '{ "version": "0.2.0" }' },
    "git show v0.3.0:CHANGELOG.md": { stdout: stamped },
    "git show v0.3.0:supabase/RELEASED": { status: 128 },
  });
  const result = await runRelease(root, ["check", "v0.3.0"], null, bad.run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("package.json's version is 0.2.0, not 0.3.0");
  expect(result.output).toContain('no entries under "## 0.3.0"');
  expect(result.output).toContain("supabase/RELEASED is missing");
});

test("a database or plugin API change counts as an upgrade, its tests and the freeze marker don't", () => {
  expect(touchesUpgradeSurface(["supabase/schemas/03_events.sql"], "")).toBe(true);
  expect(touchesUpgradeSurface(["supabase/migrations/20261101_x.sql"], "")).toBe(true);
  expect(
    touchesUpgradeSurface(["supabase/tests/database/01.test.sql", "supabase/RELEASED"], ""),
  ).toBe(false);
  expect(
    touchesUpgradeSurface([], "-export const PLUGIN_API = 1;\n+export const PLUGIN_API = 2;"),
  ).toBe(true);
  expect(touchesUpgradeSurface([], "+// mentions nothing relevant")).toBe(false);
});

test("a release that changes the database must have Upgrade notes", () => {
  const withChange = (files: string) =>
    fake({
      "git describe": { stdout: "v1.0.0\n" },
      "git diff --name-only": { stdout: files },
    }).run;
  const missing = upgradeNotesProblem(
    root,
    "HEAD",
    "HEAD",
    "- A fix.",
    withChange("supabase/schemas/x.sql\n"),
  );
  expect(missing).toMatch(/Upgrade notes/);
  expect(
    upgradeNotesProblem(
      root,
      "HEAD",
      "HEAD",
      "- A fix.\n\n### Upgrade notes\n\n- Run db migrate.",
      withChange("supabase/schemas/x.sql\n"),
    ),
  ).toBeNull();
  expect(
    upgradeNotesProblem(root, "HEAD", "HEAD", "- A fix.", withChange("apps/web/x.ts\n")),
  ).toBeNull();
});

test("the first release has nothing to upgrade from", () => {
  const { run } = fake({ "git describe": { status: 128 } });
  expect(upgradeNotesProblem(root, "HEAD", "HEAD", "- First.", run)).toBeNull();
});

test("notes drift ignores line endings and trailing space, and shows what differs", () => {
  expect(notesDrift("- A.\n- B.", "- A. \r\n- B.\r\n")).toBeNull();
  expect(notesDrift("- A.\n- B.", "- A.\n- C.")).toBe("- - C.\n+ - B.");
});
