import { loadConfig } from "./load.ts";
import { publicConfigOf, updateChecksOn } from "./resolve.ts";

const loaded = loadConfig();
const config = loaded.config;

export const brand = config.brand;
export const security = config.security;
export const disabledPlugins: Tuple<string> = config.disabledPlugins;
export const upstream = config.upstream;
export const repository: string | null = config.repository;
export const configFile: string | null = loaded.file;

export const publicConfig = publicConfigOf(config);

export function updateChecksEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return updateChecksOn(config, env);
}

export { defineConfig, type InstanceConfig } from "./define.ts";
export { publicConfigScript, type PublicConfig, type ResolvedConfig } from "./resolve.ts";
