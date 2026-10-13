import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { isPlaceholder } from "./placeholder.ts";

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

export function hostsProblem(hosts: Tuple<string>): string | null {
  if (!hosts.length) return "Give at least one host, like bogey.example.org.";
  const bad = hosts.find((host) => !HOST.test(host));
  return bad ? `"${bad}" isn't a host name (no https://, no path).` : null;
}

export function parseHosts(text: string): string[] {
  return text
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function apiKey(role: "anon" | "service_role", secret: string, now: Date): string {
  const issued = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({ role, iss: "supabase", iat: issued, exp: issued + 10 * 365 * 24 * 3600 }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function apiKeyValid(token: string, role: string, secret: string): boolean {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (expected !== signature) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return (
      typeof claims === "object" && claims !== null && "role" in claims && claims.role === role
    );
  } catch {
    return false;
  }
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function token(length: number, random: (bytes: number) => Buffer): string {
  let out = "";
  while (out.length < length) {
    for (const byte of random(length * 2)) {
      if (byte < 248 && out.length < length) out += ALPHANUMERIC[byte % 62];
    }
  }
  return out;
}

export interface AllInOneInput {
  hosts: Tuple<string>;
  http: boolean;
  existing: ReadonlyMap<string, string>;
  given?: ReadonlyMap<string, string>;
  now?: Date;
  random?: (bytes: number) => Buffer;
}

export function allInOneValues(input: AllInOneInput): Map<string, string> {
  const {
    hosts,
    http,
    existing,
    given = new Map(),
    now = new Date(),
    random = randomBytes,
  } = input;
  const out = new Map<string, string>();
  const keep = (key: string, make: () => string): string => {
    const value = given.get(key) ?? existing.get(key);
    const chosen = value && !isPlaceholder(value) ? value : make();
    out.set(key, chosen);
    return chosen;
  };
  const [main = ""] = hosts;
  const scheme = http ? "http" : "https";
  const url = `${scheme}://${main}`;

  out.set("BOGEY_HOST", main);
  out.set("BOGEY_HOSTS", hosts.join(","));
  out.set("BOGEY_URL", url);
  out.set("CADDY_SITES", hosts.map((host) => (http ? `http://${host}` : host)).join(", "));
  keep("BOGEY_IMAGE", () => "ghcr.io/0xethen/bogey:latest");
  keep("STUDIO_PORT", () => "54323");

  const postgres = keep("POSTGRES_PASSWORD", () => token(32, random));
  const jwtSecret = keep("JWT_SECRET", () => token(48, random));
  const reuse = (key: string, role: "anon" | "service_role") => {
    const old = given.get(key) ?? existing.get(key);
    const chosen = old && apiKeyValid(old, role, jwtSecret) ? old : apiKey(role, jwtSecret, now);
    out.set(key, chosen);
    return chosen;
  };
  const anon = reuse("ANON_KEY", "anon");
  const service = reuse("SERVICE_ROLE_KEY", "service_role");
  keep("SECRET_KEY_BASE", () => token(64, random));
  keep("REALTIME_DB_ENC_KEY", () => token(16, random));
  keep("PG_META_CRYPTO_KEY", () => token(32, random));
  keep("S3_PROTOCOL_ACCESS_KEY_ID", () => random(16).toString("hex"));
  keep("S3_PROTOCOL_ACCESS_KEY_SECRET", () => random(32).toString("hex"));
  keep("SEND_EMAIL_HOOK_SECRET", () => `v1,whsec_${random(32).toString("base64")}`);

  out.set("SUPABASE_URL", url);
  out.set("SUPABASE_PUBLISHABLE_KEY", anon);
  out.set("SUPABASE_SERVICE_ROLE_KEY", service);
  out.set("DATABASE_URL", `postgres://postgres:${postgres}@db:5432/postgres`);
  out.set("SITE_URL", url);
  out.set("SUPABASE_PUBLIC_URL", url);
  out.set("API_EXTERNAL_URL", `${url}/auth/v1`);
  out.set("ADDITIONAL_REDIRECT_URLS", hosts.map((host) => `${scheme}://${host}/**`).join(","));
  keep("JWT_EXPIRY", () => "3600");

  for (const [key, value] of existing) if (!out.has(key)) out.set(key, value);
  for (const [key, value] of given) out.set(key, value);
  return out;
}

export function samlPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: { type: "pkcs1", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  return privateKey.toString("base64");
}
