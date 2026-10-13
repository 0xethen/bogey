import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_KEY, SEMVER } from "@bogey/utils/keys";
import { DOWNLOAD_TIMEOUT_MS } from "./credentials.ts";
import type { Runner } from "./migrations.ts";
import { isBundled } from "./plugin-dirs.ts";

export interface PluginSpec {
  owner: string;
  repo: string;
  plugin: string;
  version: string;
}

const SPEC = /^github:([\w.-]+)\/([\w.-]+)\/([a-z0-9-]+)@(.+)$/;

export function parseSpec(text: string): PluginSpec | string {
  const match = SPEC.exec(text);
  if (!match) return `"${text}" isn't github:<owner>/<repo>/<plugin>@<version>`;
  const owner = match[1] ?? "";
  const repo = match[2] ?? "";
  const plugin = match[3] ?? "";
  const version = match[4] ?? "";
  if (!PLUGIN_KEY.test(plugin)) return `"${plugin}" isn't a plugin key`;
  if (!SEMVER.test(version)) return `"${version}" isn't a version like 1.2.3`;
  return { owner, repo, plugin, version };
}

export function specSource(spec: PluginSpec): string {
  return `github:${spec.owner}/${spec.repo}/${spec.plugin}`;
}

export function assetUrl(spec: PluginSpec): string {
  const tag = `${spec.plugin}-v${spec.version}`;
  return `https://github.com/${spec.owner}/${spec.repo}/releases/download/${tag}/${spec.plugin}-${spec.version}.tar.gz`;
}

export type Download = (url: string) => Promise<Uint8Array>;

export const httpDownload: Download = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

export interface LockEntry {
  source: string;
  version: string;
  integrity: string;
  attestation?: "release" | "provenance";
}

export type Lock = Record<string, LockEntry>;

export const LOCK_FILE = "bogey.plugins.lock";

export function readLock(root: string): Lock {
  const path = join(root, LOCK_FILE);
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const lock: Lock = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null) continue;
    const { source, version, integrity, attestation } = value as Record<string, unknown>;
    if (
      typeof source === "string" &&
      typeof version === "string" &&
      typeof integrity === "string"
    ) {
      lock[key] = {
        source,
        version,
        integrity,
        ...(attestation === "release" || attestation === "provenance" ? { attestation } : {}),
      };
    }
  }
  return lock;
}

export function writeLock(root: string, lock: Lock): void {
  const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
}

const SKIPPED = new Set(["node_modules", ".git", ".DS_Store"]);

function files(dir: string, base = ""): string[] {
  return readdirSync(join(dir, base), { withFileTypes: true })
    .filter((entry) => !SKIPPED.has(entry.name))
    .flatMap((entry) => {
      const relative = base ? `${base}/${entry.name}` : entry.name;
      return entry.isDirectory() ? files(dir, relative) : [relative];
    })
    .sort();
}

export function hashDirectory(dir: string): string {
  const hash = createHash("sha256");
  for (const file of files(dir)) {
    const bytes = readFileSync(join(dir, file));
    hash.update(`${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return `sha256-${hash.digest("hex")}`;
}

function onlyPlainFiles(dir: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      return `${entry.name} isn't a plain file or folder`;
    }
    if (stat.isDirectory()) {
      const inner = onlyPlainFiles(path);
      if (inner) return `${entry.name}/${inner}`;
    }
  }
  return null;
}

export function extractPlugin(
  bytes: Uint8Array,
  plugin: string,
  dest: string,
  run: Runner,
): { ok: true; dir: string } | { ok: false; error: string } {
  const archive = join(dest, "plugin.tar.gz");
  writeFileSync(archive, bytes);
  const listed = run("tar", ["-tzf", archive]);
  if (listed.status !== 0) return { ok: false, error: listed.stderr.trim() || "tar failed" };
  const names = listed.stdout.split("\n").filter(Boolean);
  const outside = names.find(
    (name) =>
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      !(
        name === `${plugin}/` ||
        name.startsWith(`${plugin}/`) ||
        name === `./${plugin}/` ||
        name.startsWith(`./${plugin}/`)
      ),
  );
  if (outside) return { ok: false, error: `the archive holds ${outside}, outside ${plugin}/` };
  const unpacked = join(dest, "unpacked");
  mkdirSync(unpacked);
  const extracted = run("tar", ["-xzf", archive, "-C", unpacked]);
  if (extracted.status !== 0) {
    return { ok: false, error: extracted.stderr.trim() || "tar failed" };
  }
  const odd = onlyPlainFiles(unpacked);
  if (odd) return { ok: false, error: `the archive's ${odd}` };
  const dir = join(unpacked, plugin);
  if (!existsSync(join(dir, "manifest.ts"))) {
    return { ok: false, error: `${plugin}/manifest.ts isn't in the archive` };
  }
  return { ok: true, dir };
}

export interface Fetched {
  archive: string;
  dir: string;
  integrity: string;
  cleanup: () => void;
}

export async function fetchPlugin(
  spec: PluginSpec,
  download: Download,
  run: Runner,
): Promise<{ ok: true; fetched: Fetched } | { ok: false; error: string }> {
  const temp = mkdtempSync(join(tmpdir(), "bogey-plugin-"));
  const cleanup = () => rmSync(temp, { recursive: true, force: true });
  let bytes: Uint8Array;
  try {
    bytes = await download(assetUrl(spec));
  } catch (error) {
    cleanup();
    return {
      ok: false,
      error: `couldn't download ${spec.plugin} ${spec.version}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const result = extractPlugin(bytes, spec.plugin, temp, run);
  if (!result.ok) {
    cleanup();
    return result;
  }
  return {
    ok: true,
    fetched: {
      archive: join(temp, "plugin.tar.gz"),
      dir: result.dir,
      integrity: hashDirectory(result.dir),
      cleanup,
    },
  };
}

export function place(installed: string, plugin: string, from: string): void {
  mkdirSync(installed, { recursive: true });
  const target = join(installed, plugin);
  rmSync(target, { recursive: true, force: true });
  cpSync(from, target, { recursive: true });
}

export function lockProblems(root: string): string[] {
  const installed = join(root, "packages", "plugins", "installed");
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(readLock(root))) {
    const dir = join(installed, key);
    if (isBundled(root, key)) {
      problems.push(`${key} ships with Bogey now: remove it from ${LOCK_FILE}`);
    } else if (!existsSync(dir)) {
      problems.push(`${key} is in ${LOCK_FILE} but isn't installed: run bogey plugins install`);
    } else if (hashDirectory(dir) !== entry.integrity) {
      problems.push(
        `${key} differs from ${LOCK_FILE} (${entry.version}): it was edited after install; run bogey plugins install to restore it`,
      );
    }
  }
  return problems;
}
