import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vite-plus/test";
import {
  clearWorkDir,
  inside,
  isInside,
  makeJobDir,
  prepareWorkDir,
  readContained,
  safeName,
  writeNew,
} from "../src/paths.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "runner-paths-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("file names can't climb out or hide", () => {
  for (const bad of ["../x", "a/b", ".env", "..", "", "a\0b", "x".repeat(65), "a..b"]) {
    assert.throws(() => safeName(bad, "file"), /unusable file name/, JSON.stringify(bad));
  }
  assert.equal(safeName("Main.java", "file"), "Main.java");
});

test("paths outside the folder are caught", () => {
  assert.ok(isInside("/w", "/w/a/b"));
  assert.ok(!isInside("/w", "/w/../etc"));
  assert.ok(!isInside("/w", "/wx"));
  assert.ok(!isInside("/w", "/"));
  assert.throws(() => inside("/w", "../etc/passwd"), /outside/);
});

test("the work folder is made private, and a link in its place is refused", async () => {
  const dir = join(root, "work");
  await prepareWorkDir(dir);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  const link = join(root, "link");
  await symlink(root, link);
  await assert.rejects(prepareWorkDir(link), /not a link/);
  await assert.rejects(prepareWorkDir("relative/path"), /absolute/);
});

test("leftovers from an earlier run are cleared", async () => {
  await mkdir(join(root, "j-old"));
  await writeFile(join(root, "j-old", "main.py"), "x");
  await clearWorkDir(root);
  assert.equal((await import("node:fs/promises").then((fs) => fs.readdir(root))).length, 0);
});

test("job folders get unique names; only writable ones are open to the sandbox user", async () => {
  const a = await makeJobDir(root, "j-", false);
  const b = await makeJobDir(root, "j-", true);
  assert.notEqual(a, b);
  assert.equal((await stat(a)).mode & 0o777, 0o755);
  assert.equal((await stat(b)).mode & 0o777, 0o777);
});

test("a new file is never written through a link the sandbox planted", async () => {
  const target = join(root, "secret");
  await writeFile(target, "keep");
  await symlink(target, join(root, "input"));
  await assert.rejects(writeNew(root, "input", "overwrite"));
  assert.equal(await readFile(target, "utf-8"), "keep");
  await writeNew(root, "fresh", "ok");
  assert.equal(await readFile(join(root, "fresh"), "utf-8"), "ok");
  await assert.rejects(writeNew(root, "fresh", "again"), /EEXIST/);
});

test("reading what a sandbox wrote: plain files only, capped", async () => {
  await writeFile(join(root, "output"), "x".repeat(100));
  const read = await readContained(root, "output", 10);
  assert.equal(read?.text, "x".repeat(10));
  assert.equal(read?.truncated, true);
  assert.equal(read?.size, 100);

  await writeFile(join(root, "secret"), "runner key");
  await symlink(join(root, "secret"), join(root, "score.txt"));
  assert.equal(await readContained(root, "score.txt", 64), null, "a link reads as missing");
  await symlink("/proc/self/environ", join(root, "environ"));
  assert.equal(await readContained(root, "environ", 64), null);
  await mkdir(join(root, "folder"));
  assert.equal(await readContained(root, "folder", 64), null);
  assert.equal(await readContained(root, "missing", 64), null);
  await assert.rejects(readContained(root, "../x", 64), /unusable/);
});
