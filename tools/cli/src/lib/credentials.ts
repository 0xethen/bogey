import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { busy } from "./activity.ts";
import { findRepoRoot } from "./repo-root.ts";

export const REQUEST_TIMEOUT_MS = 30_000;
export const DOWNLOAD_TIMEOUT_MS = 300_000;

export interface Credentials {
  url: string;
  serviceKey: string;
}

export type CredentialsResult =
  | { ok: true; credentials: Credentials }
  | { ok: false; error: string };

export function serviceCredentials(cwd: string): CredentialsResult {
  const root = findRepoRoot(cwd);
  const env = readEnv(join(root, ".env"));

  const url = (process.env.SUPABASE_URL ?? env.SUPABASE_URL)?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return {
      ok: false,
      error:
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Set them in .env at the repo root (see docs/self-hosting/supabase.md).",
    };
  }

  if (
    serviceKey.startsWith("sb_publishable_") ||
    serviceKey === (process.env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY)
  ) {
    return {
      ok: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY is a publishable (anon) key, so this command would silently " +
        "run with no privileges.\nUse the secret key from your project's API settings.",
    };
  }

  return { ok: true, credentials: { url, serviceKey } };
}

export function databaseUrl(cwd: string, flag: string | true | undefined): string | null {
  if (typeof flag === "string") return flag;
  if (flag === true) return null;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return readEnv(join(findRepoRoot(cwd), ".env")).DATABASE_URL || null;
}

export const NO_DATABASE_URL = "Set DATABASE_URL in .env, or pass --db-url postgres://...";

export function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return envValues(readFileSync(path, "utf-8"));
}

function envValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const at = trimmed.indexOf("=");
    if (at === -1) continue;

    const key = trimmed
      .slice(0, at)
      .replace(/^export\s+/, "")
      .trim();
    const raw = trimmed.slice(at + 1).trim();
    const quoted = /^(["'])([\s\S]*)\1(\s+#.*)?$/.exec(raw);
    out[key] = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, "");
  }

  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function parsed(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function rpc(
  credentials: Credentials,
  name: string,
  body: Record<string, unknown> = {},
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  return busy(`Talking to ${hostOf(credentials.url)}`, () => callRpc(credentials, name, body));
}

async function callRpc(
  credentials: Credentials,
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  let response: Response;

  try {
    response = await fetch(`${credentials.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: credentials.serviceKey,
        authorization: `Bearer ${credentials.serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: `Couldn't reach ${credentials.url}: ${String(error)}` };
  }

  const text = await response.text();

  if (!response.ok) {
    const message = (parsed(text) as { message?: string } | null)?.message ?? text;
    return { ok: false, error: `${name}: ${message || `HTTP ${response.status}`}` };
  }

  return { ok: true, data: parsed(text) };
}
