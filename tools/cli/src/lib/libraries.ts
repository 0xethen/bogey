import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIBRARIES_FILE,
  LibrariesFileSchema,
  OFFICIAL_LIBRARY,
  parseLibrarySource,
} from "@bogey/plugins/library";

export function readLibraries(root: string): string[] | string {
  const path = join(root, LIBRARIES_FILE);
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return `${LIBRARIES_FILE} isn't valid JSON`;
  }
  const parsed = LibrariesFileSchema.safeParse(raw);
  if (!parsed.success) {
    return `${LIBRARIES_FILE}: ${parsed.error.issues[0]?.path.join(".") || "root"}: ${parsed.error.issues[0]?.message}`;
  }
  return parsed.data.libraries;
}

export function writeLibraries(root: string, libraries: Tuple<string>): void {
  const sorted = [...new Set(libraries)].sort();
  writeFileSync(join(root, LIBRARIES_FILE), `${JSON.stringify({ libraries: sorted }, null, 2)}\n`);
}

export function searchedLibraries(root: string): string[] | string {
  const own = readLibraries(root);
  if (typeof own === "string") return own;
  return [OFFICIAL_LIBRARY, ...own.filter((source) => source !== OFFICIAL_LIBRARY)];
}

export function normalizeLibrary(text: string): string {
  const parsed = parseLibrarySource(text.trim());
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed.source;
}
