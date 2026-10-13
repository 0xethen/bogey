import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, createPrivateKey } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { runSetup } from "../../src/commands/setup.ts";
import {
  allInOneValues,
  apiKey,
  apiKeyValid,
  hostsProblem,
  parseHosts,
} from "../../src/lib/all-in-one.ts";
import { parseEnv } from "../../src/commands/setup.ts";

const repoExample = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../deploy/all-in-one/.env.example",
);

test("hosts are bare names, comma-separated", () => {
  expect(parseHosts("A.example.org, b.example.org,")).toEqual(["a.example.org", "b.example.org"]);
  expect(hostsProblem(["bogey.example.org"])).toBeNull();
  expect(hostsProblem(["localhost:8080"])).toBeNull();
  expect(hostsProblem([])).toMatch(/at least one/);
  expect(hostsProblem(["https://bogey.example.org"])).toMatch(/isn't a host name/);
  expect(hostsProblem(["bogey.example.org/path"])).toMatch(/isn't a host name/);
});

test("an api key is a JWT with the role, signed with the secret", () => {
  const key = apiKey("service_role", "s".repeat(40), new Date("2026-10-10T00:00:00Z"));
  const [header, body, signature] = key.split(".");
  expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
    alg: "HS256",
    typ: "JWT",
  });
  const claims = JSON.parse(Buffer.from(body ?? "", "base64url").toString());
  expect(claims.role).toBe("service_role");
  expect(claims.exp - claims.iat).toBe(10 * 365 * 24 * 3600);
  expect(signature).toBe(
    createHmac("sha256", "s".repeat(40)).update(`${header}.${body}`).digest("base64url"),
  );
  expect(apiKeyValid(key, "service_role", "s".repeat(40))).toBe(true);
  expect(apiKeyValid(key, "anon", "s".repeat(40))).toBe(false);
  expect(apiKeyValid(key, "service_role", "other-secret")).toBe(false);
  expect(apiKeyValid("nope", "anon", "x")).toBe(false);
});

test("secrets are made once and kept on a second run", () => {
  const first = allInOneValues({ hosts: ["bogey.example.org"], http: false, existing: new Map() });
  expect(first.get("BOGEY_URL")).toBe("https://bogey.example.org");
  expect(first.get("API_EXTERNAL_URL")).toBe("https://bogey.example.org/auth/v1");
  expect(first.get("ADDITIONAL_REDIRECT_URLS")).toBe("https://bogey.example.org/**");
  expect(first.get("REALTIME_DB_ENC_KEY")).toHaveLength(16);
  expect(first.get("JWT_SECRET")?.length).toBeGreaterThanOrEqual(32);
  expect(first.get("POSTGRES_PASSWORD")).toMatch(/^[A-Za-z0-9]{32}$/);
  expect(first.get("SEND_EMAIL_HOOK_SECRET")).toMatch(/^v1,whsec_[A-Za-z0-9+/=]{32,}$/);
  expect(first.get("DATABASE_URL")).toBe(
    `postgres://postgres:${first.get("POSTGRES_PASSWORD")}@db:5432/postgres`,
  );
  const secret = first.get("JWT_SECRET") ?? "";
  expect(apiKeyValid(first.get("ANON_KEY") ?? "", "anon", secret)).toBe(true);
  expect(apiKeyValid(first.get("SERVICE_ROLE_KEY") ?? "", "service_role", secret)).toBe(true);
  expect(first.get("SUPABASE_PUBLISHABLE_KEY")).toBe(first.get("ANON_KEY"));
  expect(first.get("SUPABASE_SERVICE_ROLE_KEY")).toBe(first.get("SERVICE_ROLE_KEY"));

  const again = allInOneValues({
    hosts: ["bogey.example.org", "other.example.org"],
    http: false,
    existing: first,
  });
  for (const key of ["POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    expect(again.get(key)).toBe(first.get(key));
  }
  expect(again.get("BOGEY_HOSTS")).toBe("bogey.example.org,other.example.org");
  expect(again.get("CADDY_SITES")).toBe("bogey.example.org, other.example.org");
});

test("a changed JWT secret gets keys signed with it", () => {
  const first = allInOneValues({ hosts: ["a.example.org"], http: false, existing: new Map() });
  const rotated = allInOneValues({
    hosts: ["a.example.org"],
    http: false,
    existing: new Map([...first, ["JWT_SECRET", "x".repeat(40)]]),
  });
  expect(apiKeyValid(rotated.get("ANON_KEY") ?? "", "anon", "x".repeat(40))).toBe(true);
});

test("--http is http everywhere", () => {
  const values = allInOneValues({ hosts: ["bogey.test"], http: true, existing: new Map() });
  expect(values.get("BOGEY_URL")).toBe("http://bogey.test");
  expect(values.get("CADDY_SITES")).toBe("http://bogey.test");
  expect(values.get("ADDITIONAL_REDIRECT_URLS")).toBe("http://bogey.test/**");
});

test("bogey setup --all-in-one writes a private .env and keeps it on a re-run", async () => {
  const out = mkdtempSync(join(tmpdir(), "bogey-aio-"));
  mkdirSync(out, { recursive: true });
  copyFileSync(repoExample, join(out, ".env.example"));

  const first = await runSetup(
    out,
    ["--all-in-one", "--host", "bogey.example.org", "--out", out],
    null,
  );
  expect(first.exitCode).toBe(0);
  expect(first.output).toContain("https://bogey.example.org");
  expect(first.output).toMatch(/SMTP_HOST and SMTP_FROM/);
  expect(statSync(join(out, ".env")).mode & 0o777).toBe(0o600);
  const env = parseEnv(readFileSync(join(out, ".env"), "utf-8"));
  expect(env.get("SUPABASE_URL")).toBe("https://bogey.example.org");
  expect(env.get("GOOGLE_ENABLED")).toBe("false");
  expect(env.get("POSTGRES_PASSWORD")).toHaveLength(32);

  const second = await runSetup(
    out,
    ["--all-in-one", "--out", out, "--smtp-host", "smtp.mail.org", "--smtp-from", "hi@mail.org"],
    null,
  );
  expect(second.exitCode).toBe(0);
  expect(second.output).not.toMatch(/SMTP_HOST/);
  const kept = parseEnv(readFileSync(join(out, ".env"), "utf-8"));
  expect(kept.get("POSTGRES_PASSWORD")).toBe(env.get("POSTGRES_PASSWORD"));
  expect(kept.get("SMTP_HOST")).toBe("smtp.mail.org");
  expect(kept.get("BOGEY_HOSTS")).toBe("bogey.example.org");
});

test("setup --all-in-one without a host or a terminal says what is missing", async () => {
  const out = mkdtempSync(join(tmpdir(), "bogey-aio-"));
  copyFileSync(repoExample, join(out, ".env.example"));
  const result = await runSetup(out, ["--all-in-one", "--out", out], null);
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(/at least one/);
});

test("every variable the compose file requires is in .env.example and made by setup", () => {
  const compose = readFileSync(join(dirname(repoExample), "compose.yml"), "utf-8");
  const required = [...compose.matchAll(/\$\{([A-Z0-9_]+)(?::\?[^}]*)?\}/g)].map(
    (match) => match[1],
  );
  const example = readFileSync(repoExample, "utf-8");
  const made = allInOneValues({ hosts: ["bogey.example.org"], http: false, existing: new Map() });
  for (const name of new Set(required)) {
    expect(example, name).toMatch(new RegExp(`^${name}=`, "m"));
    expect(made.get(name) || /smtp/i.test(name), name).toBeTruthy();
  }
});

test("--saml makes the signing key Auth expects, and keeps it on a re-run", async () => {
  const out = mkdtempSync(join(tmpdir(), "bogey-aio-"));
  copyFileSync(repoExample, join(out, ".env.example"));
  await runSetup(out, ["--all-in-one", "--host", "a.example.org", "--out", out, "--saml"], null);
  const first = parseEnv(readFileSync(join(out, ".env"), "utf-8"));
  expect(first.get("SAML_ENABLED")).toBe("true");
  const der = Buffer.from(first.get("SAML_PRIVATE_KEY") ?? "", "base64");
  expect(der[0]).toBe(0x30);
  expect(createPrivateKey({ key: der, format: "der", type: "pkcs1" }).asymmetricKeyType).toBe(
    "rsa",
  );
  await runSetup(out, ["--all-in-one", "--out", out, "--saml"], null);
  const second = parseEnv(readFileSync(join(out, ".env"), "utf-8"));
  expect(second.get("SAML_PRIVATE_KEY")).toBe(first.get("SAML_PRIVATE_KEY"));
});
