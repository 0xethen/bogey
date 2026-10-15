import { z } from "zod";
import { THEMES, type ThemeKey } from "./themes.gen.ts";
import { isCoreNamespace, settingsRegistry, type CoreNamespace } from "./settings.ts";
import type { InstanceConfig } from "./define.ts";

const themeKeys = THEMES.map((theme) => theme.key) as unknown as [ThemeKey, ...ThemeKey[]];
const repositoryRef = z.string().regex(/^github:[\w.-]+\/[\w.-]+$/, "use github:owner/repo");
const iconPath = z.string().min(1);
const network = settingsRegistry.network.schema.shape;
const frameSource = z
  .string()
  .regex(/^('self'|'none'|https?:\/\/[^\s;,]+)$/, "use 'self', 'none' or an https:// origin");

const configSchema = z.object({
  brand: z.object({
    name: z.string().min(1, "brand.name can't be empty"),
    shortName: z.string().min(1).optional(),
    theme: z.enum(themeKeys).optional(),
    icons: z.object({ default: iconPath, dark: iconPath.optional() }).optional(),
  }),
  appUrl: settingsRegistry.tenancy.schema.shape.appUrl,
  plugins: z.object({ disabled: z.array(z.string()).optional() }).optional(),
  network: z
    .object({
      trustProxy: z.boolean().optional(),
      clientIpHeader: network.clientIpHeader,
      trustedHops: network.trustedHops,
      trustedProxies: network.trustedProxies,
    })
    .strict()
    .optional(),
  security: z
    .object({
      verboseErrors: z.boolean().optional(),
      requireAdminMfa: z.boolean().optional(),
      headers: z
        .object({
          frameAncestors: z.array(frameSource).optional(),
          hsts: z.boolean().optional(),
          contentSecurityPolicy: z.union([z.string().min(1), z.literal(false)]).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  upstream: repositoryRef.optional(),
  repository: z.union([repositoryRef, z.literal(false)]).optional(),
  updates: z.object({ check: z.boolean().optional() }).optional(),
});

export const RUNTIME_KEYS = [
  "brand",
  "appUrl",
  "repository",
  "upstream",
  "updates",
  "network",
  "security",
  "plugins.disabled",
] as const;

export interface SecurityHeaders {
  frameAncestors: Tuple<string>;
  hsts: boolean;
  contentSecurityPolicy: string | null;
}

export type OperatorSettings = Partial<Record<CoreNamespace, Record<string, unknown>>>;

export interface ResolvedConfig {
  brand: InstanceConfig["brand"];
  security: { verboseErrors: boolean; headers: SecurityHeaders };
  trustProxy: boolean;
  operator: OperatorSettings;
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

function declared(values: Record<string, unknown>): Record<string, unknown> | undefined {
  const out = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  return Object.keys(out).length > 0 ? out : undefined;
}

function operatorSettingsOf(config: z.infer<typeof configSchema>): OperatorSettings {
  const out: OperatorSettings = {};
  const tenancy = declared({ appUrl: config.appUrl });
  const accounts = declared({ requireAdminMfa: config.security?.requireAdminMfa });
  const network = declared({
    clientIpHeader: config.network?.clientIpHeader,
    trustedHops: config.network?.trustedHops,
    trustedProxies: config.network?.trustedProxies,
  });
  if (tenancy) out.tenancy = tenancy;
  if (accounts) out.accounts = accounts;
  if (network) out.network = network;
  return out;
}

export function resolveConfig(raw: unknown): ResolvedConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new Error(configProblems(raw).join("\n"));
  const config = parsed.data;
  const upstream = config.upstream ?? DEFAULT_UPSTREAM;
  const headers = config.security?.headers;
  return {
    brand: config.brand,
    security: {
      verboseErrors: config.security?.verboseErrors ?? false,
      headers: {
        frameAncestors: headers?.frameAncestors ?? ["'self'"],
        hsts: headers?.hsts ?? false,
        contentSecurityPolicy: headers?.contentSecurityPolicy || null,
      },
    },
    trustProxy: config.network?.trustProxy ?? false,
    operator: operatorSettingsOf(config),
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

export function securityHeadersOf(headers: SecurityHeaders): Record<string, string> {
  const frames = headers.frameAncestors.length > 0 ? headers.frameAncestors.join(" ") : "'none'";
  const csp = headers.contentSecurityPolicy;
  const frameOptions = { "'none'": "DENY", "'self'": "SAMEORIGIN" }[frames];
  return {
    "content-security-policy":
      csp && /frame-ancestors/i.test(csp)
        ? csp
        : [csp, `frame-ancestors ${frames}`].filter(Boolean).join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...(frameOptions ? { "x-frame-options": frameOptions } : {}),
    ...(headers.hsts ? { "strict-transport-security": "max-age=15552000" } : {}),
  };
}

export interface OperatorChange {
  namespace: CoreNamespace;
  value: Record<string, unknown>;
  keys: Tuple<string>;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function operatorChanges(
  operator: OperatorSettings,
  stored: Partial<Record<CoreNamespace, Record<string, unknown>>>,
): OperatorChange[] {
  const changes: OperatorChange[] = [];
  for (const [namespace, values] of Object.entries(operator)) {
    if (!isCoreNamespace(namespace) || !values) continue;
    const current = stored[namespace] ?? {};
    const keys = Object.keys(values).filter((key) => !same(current[key], values[key]));
    if (keys.length > 0) changes.push({ namespace, value: { ...current, ...values }, keys });
  }
  return changes;
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
