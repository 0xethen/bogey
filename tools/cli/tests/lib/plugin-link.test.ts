import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import { linkPluginFolder } from "../../src/lib/plugin-link.ts";

let root: string;
let folder: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "bogey-link-"));
  root = join(base, "monorepo");
  folder = join(base, "extensions");
  mkdirSync(folder);
  const pkg = join(root, "packages", "plugins");
  const store = join(root, "node_modules", ".pnpm");
  mkdirSync(join(store, "react"), { recursive: true });
  writeFileSync(join(store, "react", "index.js"), "// react\n");
  mkdirSync(join(pkg, "node_modules", "@bogey", "ui"), { recursive: true });
  mkdirSync(join(pkg, "node_modules", "@tanstack", "react-query"), { recursive: true });
  mkdirSync(join(pkg, "node_modules", ".bin"), { recursive: true });
  symlinkSync(join(store, "react"), join(pkg, "node_modules", "react"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
});

test("installed/ points at the folder, which gets the plugins package's dependencies", () => {
  const result = linkPluginFolder(root, folder);
  expect(result.ok).toBe(true);
  const installed = join(root, "packages", "plugins", "installed");
  expect(lstatSync(installed).isSymbolicLink()).toBe(true);
  expect(realpathSync(installed)).toBe(realpathSync(folder));

  const modules = join(folder, "node_modules");
  expect(realpathSync(join(modules, "react"))).toBe(
    realpathSync(join(root, "node_modules", ".pnpm", "react")),
  );
  expect(existsSync(join(modules, "@bogey", "ui"))).toBe(true);
  expect(existsSync(join(modules, "@tanstack", "react-query"))).toBe(true);
  expect(existsSync(join(modules, ".bin"))).toBe(false);
});

test("a plugin repository's plugins/ folder is what installed/ points at", () => {
  mkdirSync(join(folder, "plugins", "hello"), { recursive: true });
  const result = linkPluginFolder(root, folder);
  expect(result.ok).toBe(true);
  const installed = join(root, "packages", "plugins", "installed");
  expect(realpathSync(installed)).toBe(realpathSync(join(folder, "plugins")));
  expect(existsSync(join(folder, "node_modules", "react"))).toBe(true);
});

test("a plugin can import the plugin API: @bogey/plugins is the plugins package", () => {
  linkPluginFolder(root, folder);
  const self = join(folder, "node_modules", "@bogey", "plugins");
  expect(realpathSync(self)).toBe(realpathSync(join(root, "packages", "plugins")));
});

test("links are relative, so moving both checkouts together keeps them working", () => {
  linkPluginFolder(root, folder);
  expect(readlinkSync(join(root, "packages", "plugins", "installed"))).toMatch(/^\.\.\//);
});

test("linking again replaces a tsconfig.json it wrote, and keeps one that was edited", () => {
  linkPluginFolder(root, folder);
  const tsconfig = join(folder, "tsconfig.json");
  const written = readFileSync(tsconfig, "utf-8");
  expect(written).not.toContain("made by");
  linkPluginFolder(root, folder);
  expect(readFileSync(tsconfig, "utf-8")).toBe(written);
  writeFileSync(tsconfig, `${written}\n`);
  linkPluginFolder(root, folder);
  expect(readFileSync(tsconfig, "utf-8")).toBe(`${written}\n`);
});

test("linking again replaces what it made", () => {
  linkPluginFolder(root, folder);
  expect(linkPluginFolder(root, folder).ok).toBe(true);
  expect(readFileSync(join(folder, "node_modules", ".bogey-link"), "utf-8")).toContain(
    "bogey plugins link",
  );
});

test("it replaces an old symlinked node_modules, but not a real one it didn't make", () => {
  symlinkSync(join(root, "packages", "plugins", "node_modules"), join(folder, "node_modules"));
  expect(linkPluginFolder(root, folder).ok).toBe(true);
  expect(lstatSync(join(folder, "node_modules")).isSymbolicLink()).toBe(false);

  const other = join(folder, "..", "other");
  mkdirSync(join(other, "node_modules"), { recursive: true });
  writeFileSync(join(other, "node_modules", "mine.txt"), "keep");
  const refused = linkPluginFolder(root, other);
  expect(refused.ok).toBe(false);
  expect(existsSync(join(other, "node_modules", "mine.txt"))).toBe(true);
});

test("it won't discard plugins already in installed/", () => {
  const installed = join(root, "packages", "plugins", "installed");
  mkdirSync(join(installed, "mine"), { recursive: true });
  const result = linkPluginFolder(root, folder);
  expect(result.ok).toBe(false);
  expect(existsSync(join(installed, "mine"))).toBe(true);
});

test("an empty installed/ is replaced", () => {
  mkdirSync(join(root, "packages", "plugins", "installed"), { recursive: true });
  expect(linkPluginFolder(root, folder).ok).toBe(true);
});

test("a folder that doesn't exist is refused", () => {
  const result = linkPluginFolder(root, join(folder, "nope"));
  expect(result.ok).toBe(false);
});
