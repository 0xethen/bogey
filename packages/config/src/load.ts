import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG, resolveConfig, type ResolvedConfig } from "./resolve.ts";

const FILE_NAMES = ["bogey.config.ts", "bogey.config.mjs", "bogey.config.js", "bogey.config.json"];

export function findConfigFile(
  env: Readonly<Record<string, string | undefined>> = process.env,
  from: string = process.cwd(),
): string | null {
  if (env.BOGEY_CONFIG) return resolve(from, env.BOGEY_CONFIG);
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    for (const name of FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    if (dirname(dir) === dir) return null;
  }
}

export function readConfigFile(file: string): unknown {
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const loaded: unknown = createRequire(file)(file);
  if (typeof loaded === "object" && loaded !== null && "default" in loaded) return loaded.default;
  return loaded;
}

export interface LoadedConfig {
  config: ResolvedConfig;
  file: string | null;
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  from: string = process.cwd(),
): LoadedConfig {
  const file = findConfigFile(env, from);
  if (!file) return { config: resolveConfig(DEFAULT_CONFIG), file: null };
  if (!existsSync(file)) throw new Error(`BOGEY_CONFIG points at ${file}, which doesn't exist.`);
  let raw: unknown;
  try {
    raw = readConfigFile(file);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Couldn't read ${file}: ${reason}`, { cause });
  }
  try {
    return { config: resolveConfig(raw), file };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${file} isn't valid:\n${reason}`, { cause });
  }
}
