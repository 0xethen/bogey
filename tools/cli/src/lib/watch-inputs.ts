import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, watch } from "node:fs";
import { join, relative } from "node:path";

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function ignored(root: string, paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    encoding: "utf-8",
    input: paths.map((path) => relative(root, path)).join("\0"),
  });
  return new Set(
    (result.stdout ?? "")
      .split("\0")
      .filter(Boolean)
      .map((path) => join(root, path)),
  );
}

// Content of every input that git doesn't ignore, so saving a file unchanged re-runs nothing.
function fingerprint(root: string, inputs: string[]): string {
  const all = inputs.flatMap(files);
  const skip = ignored(root, all);
  const hash = createHash("sha1");
  for (const path of all.filter((path) => !skip.has(path)).sort()) {
    hash.update(path).update(readFileSync(path));
  }
  return hash.digest("hex");
}

// Calls run only when the content of the given files or folders (minus gitignored ones) changed.
export function watchInputs(root: string, inputs: string[], run: () => void): () => void {
  const paths = inputs.map((input) => join(root, input));
  let last = fingerprint(root, paths);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = fingerprint(root, paths);
      if (next === last) return;
      last = next;
      run();
    }, 200);
  };
  const watchers = paths
    .filter((path) => existsSync(path))
    .map((path) => watch(path, { recursive: true }, onChange));
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
