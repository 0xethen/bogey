import { DEFAULT_CONFIG, DEFAULT_UPSTREAM, type PublicConfig } from "./resolve.ts";

const handed: PublicConfig = globalThis.__BOGEY_CONFIG__ ?? {
  brand: DEFAULT_CONFIG.brand,
  repository: DEFAULT_UPSTREAM,
  disabledPlugins: [],
  eventDeletion: true,
  verboseErrors: false,
};

export const brand = handed.brand;
export const security = { verboseErrors: handed.verboseErrors };
export const disabledPlugins: Tuple<string> = handed.disabledPlugins;
export const eventDeletion: boolean = handed.eventDeletion;
export const repository: string | null = handed.repository;

export const publicConfig: PublicConfig = handed;

export { defineConfig, type InstanceConfig } from "./define.ts";
export { publicConfigScript, type PublicConfig } from "./resolve.ts";
