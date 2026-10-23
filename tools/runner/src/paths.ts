import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { InfraError } from "./types.ts";

// file names a language or package may use: no slashes, no dot-dot, no leading dot
export const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

export function safeName(name: string, what: string): string {
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    throw new InfraError(`${what} has an unusable file name "${name}"`);
  }
  return name;
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function inside(root: string, ...parts: string[]): string {
  const path = resolve(root, ...parts);
  if (!isInside(root, path)) throw new InfraError(`${parts.join("/")} is outside ${root}`);
  return path;
}

/**
 * Makes the runner's own work folder: a real directory owned by this process, closed to other
 * users. Refuses a symlink, so a planted link can't point the runner's writes elsewhere.
 */
export async function prepareWorkDir(dir: string): Promise<string> {
  if (!isAbsolute(dir))
    throw new Error(`BOGEY_RUNNER_WORK_DIR must be an absolute path, not "${dir}"`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${dir} must be a directory, not a link`);
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error(
      `${dir} belongs to uid ${info.uid}; the runner (uid ${process.getuid()}) must own it`,
    );
  }
  await chmod(dir, 0o700);
  return dir;
}

/** Removes what an earlier run left in the work folder. */
export async function clearWorkDir(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(entries.map((entry) => rm(join(dir, entry), { recursive: true, force: true })));
}

/**
 * A fresh folder for one step. `writable` folders are open to the sandbox's user (65534); the
 * work folder above them is 0700, so no other user on the host can reach them.
 */
export async function makeJobDir(
  parent: string,
  prefix: string,
  writable: boolean,
): Promise<string> {
  const dir = await mkdtemp(join(parent, prefix));
  await chmod(dir, writable ? 0o777 : 0o755);
  return dir;
}

/** Writes a new file the sandbox will read. Never follows or replaces a link. */
export async function writeNew(dir: string, name: string, data: string): Promise<string> {
  const path = inside(dir, safeName(name, "file"));
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(data, "utf-8");
  } finally {
    await handle.close();
  }
  return path;
}

export interface ContainedRead {
  text: string;
  size: number;
  truncated: boolean;
}

/**
 * Reads a file a sandbox wrote, at most `max` bytes. Anything that isn't a plain file directly in
 * `dir` (a link, a FIFO, a device, a folder) reads as missing, so sandboxed code can't make the
 * runner read its own secrets or another judging's files.
 */
export async function readContained(
  dir: string,
  name: string,
  max: number,
): Promise<ContainedRead | null> {
  const path = inside(dir, safeName(name, "file"));
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1) return null;
    const length = Math.min(info.size, max);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return {
      text: buffer.subarray(0, read).toString("utf-8"),
      size: info.size,
      truncated: info.size > max,
    };
  } finally {
    await handle.close();
  }
}
