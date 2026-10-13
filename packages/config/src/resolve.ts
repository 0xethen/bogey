import { z } from "zod";
import { THEMES, type ThemeKey } from "./themes.gen.ts";
import type { InstanceConfig } from "./define.ts";

const themeKeys = THEMES.map((theme) => theme.key) as unknown as [ThemeKey, ...ThemeKey[]];
const repositoryRef = z.string().regex(/^github:[\w.-]+\/[\w.-]+$/, "use github:owner/repo");
const iconPath = z.string().min(1);

const configSchema = z.object({
  brand: z.object({
    name: z.string().min(1, "brand.name can't be empty"),
    shortName: z.string().min(1).optional(),
    theme: z.enum(themeKeys).optional(),
    icons: z.object({ default: iconPath, dark: iconPath.optional() }).optional(),
  }),
  plugins: z.object({ disabled: z.array(z.string()).optional() }).optional(),
  security: z.object({ verboseErrors: z.boolean().optional() }).optional(),
  upstream: repositoryRef.optional(),
  repository: z.union([repositoryRef, z.literal(false)]).optional(),
  updates: z.object({ check: z.boolean().optional() }).optional(),
});

export const RUNTIME_KEYS = [
  "brand",
  "repository",
  "upstream",
  "updates",
  "security",
  "plugins.disabled",
] as const;

export interface ResolvedConfig {
  brand: InstanceConfig["brand"];
  security: { verboseErrors: boolean };
  disabledPlugins: Tuple<string>;
  upstream: string;
  repository: string | null;
  updateCheck: boolean;
}

export interface PublicConfig {
  brand: InstanceConfig["brand"];
  repository: string | null;
  disabledPlugins: Tuple<string>;
  verboseErrors: boolean;
}

export const DEFAULT_UPSTREAM = "github:0xethen/bogey";

export const DEFAULT_CONFIG: InstanceConfig = { brand: { name: "Bogey" } };

export function configProblems(raw: unknown): string[] {
  const parsed = configSchema.safeParse(raw);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function resolveConfig(raw: unknown): ResolvedConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new Error(configProblems(raw).join("\n"));
  const config = parsed.data;
  const upstream = config.upstream ?? DEFAULT_UPSTREAM;
  return {
    brand: config.brand,
    security: { verboseErrors: config.security?.verboseErrors ?? false },
    disabledPlugins: config.plugins?.disabled ?? [],
    upstream,
    repository: config.repository === false ? null : (config.repository ?? upstream),
    updateCheck: config.updates?.check ?? true,
  };
}

export function publicConfigOf(config: ResolvedConfig): PublicConfig {
  return {
    brand: config.brand,
    repository: config.repository,
    disabledPlugins: config.disabledPlugins,
    verboseErrors: config.security.verboseErrors,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __BOGEY_CONFIG__: PublicConfig | undefined;
}

export function publicConfigScript(config: PublicConfig): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `window.__BOGEY_CONFIG__=${json};`;
}

export function updateChecksOn(
  config: Pick<ResolvedConfig, "updateCheck">,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const off = ["0", "false", "off", "no"].includes((env.BOGEY_UPDATE_CHECK ?? "").toLowerCase());
  return config.updateCheck && !off;
}
