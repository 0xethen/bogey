import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { intro, type Prompter } from "../lib/prompt.ts";
import { dim } from "../lib/style.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import { isPlaceholder } from "../lib/placeholder.ts";
import { allInOneValues, hostsProblem, parseHosts, samlPrivateKey } from "../lib/all-in-one.ts";
import { parseFlags } from "../lib/flags.ts";
import { spawnRunner, type Runner } from "../lib/migrations.ts";
import { runDb } from "./db.ts";
import { runOrgInit } from "./org-init.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey setup [--missing-only] [--from-env]
bogey setup --all-in-one --host <host>[,<host>...] [--http] [--out <dir>] [--smtp-host ...]

Writes the root .env from .env.example, asking for each value (secrets show
as dots), then offers to apply the database schema (bogey db migrate) and to create the
first organization (bogey org init).

  --missing-only   Only ask for values .env doesn't have yet
  --from-env       Don't ask: take every value from the environment (for CI),
                   and fail when a required one is missing

--all-in-one writes the .env for deploy/all-in-one (Bogey, the Supabase services it
needs and Caddy in one compose file) and makes every secret it needs: the database
password, the JWT secret, the anon and service keys signed with it, the Realtime and
Studio keys and the Send Email hook secret. Run it again to change hosts or mail;
secrets that exist are kept.

  --host <hosts>   Where Bogey is served, comma-separated; the first is the main one
  --http           A trial without certificates: http:// everywhere
  --saml           Turn on SAML single sign-on and make its signing key
  --out <dir>      Where .env goes (default deploy/all-in-one; in the image, a mounted folder)
  --smtp-host --smtp-port --smtp-user --smtp-pass --smtp-from
                   The mail server, if you'd rather not edit .env afterwards`;

export interface EnvEntry {
  key: string;
  help: string[];
  example: string;
}

const REQUIRED = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

export function parseExample(text: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  let help: string[] = [];
  for (const line of text.split("\n")) {
    const comment = /^#\s?(.*)$/.exec(line);
    if (comment) {
      help.push(comment[1] ?? "");
      continue;
    }
    const pair = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (pair) entries.push({ key: pair[1] ?? "", help, example: pair[2] ?? "" });
    if (!line.trim() || pair) help = [];
  }
  return entries;
}

export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const pair = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (pair) values.set(pair[1] ?? "", pair[2] ?? "");
  }
  return values;
}

export function isSecret(key: string): boolean {
  return /KEY|PASS|SECRET/.test(key) || key === "DATABASE_URL";
}

export { isPlaceholder };

export function invalid(key: string, value: string): string | null {
  if (!value) return REQUIRED.includes(key) ? "Required." : null;
  if (key === "SUPABASE_URL" && !/^https?:\/\/[^\s/]+/.test(value)) {
    return "A URL like http://localhost:8000.";
  }
  if (key === "DATABASE_URL" && !/^postgres(ql)?:\/\/\S+$/.test(value)) {
    return "A URL like postgres://postgres:password@localhost:5432/postgres.";
  }
  if (key === "SMTP_PORT" && !/^\d{2,5}$/.test(value)) return "A port number, like 587.";
  if (key === "BOGEY_TRUST_PROXY" && value !== "1") return "1, or leave it empty.";
  if (key === "SEND_EMAIL_HOOK_SECRET" && !/^v1,whsec_[A-Za-z0-9+/=]{32,}$/.test(value)) {
    return "v1,whsec_ followed by a base64 secret. Leave it empty to generate one.";
  }
  if (/PUBLISHABLE_KEY/.test(key) && value.startsWith("sb_secret_")) {
    return "That's a secret key; the publishable one goes here.";
  }
  return null;
}

export function hookSecret(): string {
  return `v1,whsec_${randomBytes(32).toString("base64")}`;
}

export function renderEnv(entries: Tuple<EnvEntry>, values: ReadonlyMap<string, string>): string {
  const known = new Set(entries.map((entry) => entry.key));
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.help.length) lines.push("", ...entry.help.map((line) => `# ${line}`.trimEnd()));
    lines.push(`${entry.key}=${values.get(entry.key) ?? ""}`);
  }
  const extra = [...values].filter(([key]) => !known.has(key));
  if (extra.length) lines.push("", "# Not in .env.example", ...extra.map(([k, v]) => `${k}=${v}`));
  return `${lines.join("\n").trim()}\n`;
}

const SMTP_FLAGS: Readonly<Record<string, string>> = {
  "smtp-host": "SMTP_HOST",
  "smtp-port": "SMTP_PORT",
  "smtp-user": "SMTP_USER",
  "smtp-pass": "SMTP_PASS",
  "smtp-from": "SMTP_FROM",
};

async function runAllInOne(
  cwd: string,
  args: string[],
  prompter: Prompter | null,
): Promise<CliResult> {
  const flags = parseFlags(args);
  const home = (() => {
    try {
      return join(findRepoRoot(cwd), "deploy", "all-in-one");
    } catch {
      return null;
    }
  })();
  const out = typeof flags.out === "string" ? resolve(cwd, flags.out) : home;
  if (!out) return { exitCode: 1, output: "Pass --out <folder> for where .env should go." };
  const examplePath = [join(out, ".env.example"), home && join(home, ".env.example")].find(
    (path): path is string => !!path && existsSync(path),
  );
  if (!examplePath) {
    return {
      exitCode: 1,
      output: `No .env.example in ${out}. Unpack the all-in-one files there first.`,
    };
  }
  const envPath = join(out, ".env");
  const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf-8")) : new Map();

  let hostText = typeof flags.host === "string" ? flags.host : existing.get("BOGEY_HOSTS");
  if (!hostText && prompter) {
    hostText = await prompter.text({
      message: "Host name(s) Bogey will be served on",
      placeholder: "bogey.example.org",
      hint: "Comma-separated; the first is the main one. DNS must point at this server.",
      validate: (value) => hostsProblem(parseHosts(value)),
    });
  }
  const hosts = parseHosts(hostText ?? "");
  const problem = hostsProblem(hosts);
  if (problem) return { exitCode: 1, output: `bogey setup --all-in-one: ${problem}` };

  const given = new Map<string, string>();
  if (flags.saml === true) {
    given.set("SAML_ENABLED", "true");
    const old = existing.get("SAML_PRIVATE_KEY");
    given.set("SAML_PRIVATE_KEY", old || samlPrivateKey());
  }
  for (const [flag, key] of Object.entries(SMTP_FLAGS)) {
    const value = flags[flag];
    if (typeof value === "string") given.set(key, value);
  }
  const entries = parseExample(readFileSync(examplePath, "utf-8"));
  const base = new Map(entries.map((entry) => [entry.key, entry.example] as const));
  const values = allInOneValues({
    hosts,
    http:
      flags.http === true ||
      (!flags.host && existing.get("BOGEY_URL")?.startsWith("http://") === true),
    existing: new Map([...base, ...existing]),
    given,
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(envPath, renderEnv(entries, values), { mode: 0o600 });

  const placeholders = ["SMTP_HOST", "SMTP_FROM"].filter((key) =>
    isPlaceholder(values.get(key) ?? ""),
  );
  const lines = [
    `✓ Wrote ${envPath} (private; it holds every secret).`,
    `  Bogey will be at ${values.get("BOGEY_URL")}`,
  ];
  if (placeholders.length) {
    lines.push(
      `  Set ${placeholders.join(" and ")} in it before inviting anyone (docs/self-hosting/email.md).`,
    );
  }
  lines.push(
    "",
    "Next:",
    `  cd ${out} && docker compose up -d`,
    '  docker compose exec web bogey org init --org <slug> --name "<Name>" --owner <you@example.org> --host ' +
      (hosts[0] ?? ""),
  );
  return { exitCode: 0, output: lines.join("\n") };
}

export async function runSetup(
  cwd: string,
  args: string[],
  prompter: Prompter | null,
  env: NodeJS.ProcessEnv = process.env,
  run: Runner = spawnRunner,
): Promise<CliResult> {
  if (args.includes("--all-in-one")) return runAllInOne(cwd, args, prompter);
  const root = findRepoRoot(cwd);
  const examplePath = join(root, ".env.example");
  const envPath = join(root, ".env");
  if (!existsSync(examplePath)) return { exitCode: 1, output: "No .env.example at the repo root." };

  const entries = parseExample(readFileSync(examplePath, "utf-8"));
  const current = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf-8")) : new Map();
  const values = new Map<string, string>(current);

  if (args.includes("--from-env")) {
    const problems: string[] = [];
    for (const entry of entries) {
      const value = env[entry.key] ?? current.get(entry.key) ?? "";
      const problem = invalid(entry.key, value);
      if (problem) problems.push(`${entry.key}: ${problem}`);
      values.set(entry.key, value);
    }
    if (problems.length)
      return { exitCode: 1, output: `Not writing .env:\n  ${problems.join("\n  ")}` };
    writeFileSync(envPath, renderEnv(entries, values));
    return { exitCode: 0, output: "✓ Wrote .env from the environment." };
  }

  if (!prompter) {
    return {
      exitCode: 1,
      output:
        "This doesn't look like a terminal. Try bogey setup --from-env to take values from the environment.",
    };
  }

  prompter.say(intro("bogey setup"));
  const missingOnly = args.includes("--missing-only");
  if (current.size && !missingOnly) {
    const again = await prompter.confirm({
      message: ".env exists. Go through every value?",
      initial: true,
    });
    if (!again) return { exitCode: 0, output: "Left .env as it was." };
  }

  for (const entry of entries) {
    const existing = current.get(entry.key) ?? "";
    if (missingOnly && existing && !isPlaceholder(existing)) continue;
    const fallback =
      existing && !isPlaceholder(existing)
        ? existing
        : isPlaceholder(entry.example)
          ? ""
          : entry.example;
    const secret = isSecret(entry.key);
    let value = await prompter.text({
      message: entry.key,
      initial: fallback || undefined,
      placeholder: fallback && secret ? "(keep current)" : undefined,
      hint: entry.help.join("\n") || undefined,
      secret,
      optional: !REQUIRED.includes(entry.key),
      validate: (answer) => invalid(entry.key, answer),
    });
    if (!value && entry.key === "SEND_EMAIL_HOOK_SECRET") {
      value = hookSecret();
      prompter.say(
        dim("   Generated one. Give GoTrue the same value (docs/self-hosting/email.md)."),
      );
    }
    values.set(entry.key, value);
  }

  writeFileSync(envPath, renderEnv(entries, values));
  const lines = ["✓ Wrote .env."];

  const dbUrl = values.get("DATABASE_URL");
  let schemaApplied = false;
  if (dbUrl) {
    const apply = await prompter.confirm({
      message: "Apply the database schema now?",
      initial: true,
    });
    if (apply) {
      const migrated = runDb(root, ["migrate", "--db-url", dbUrl], () => {}, run);
      lines.push(migrated.output);
      if (migrated.exitCode !== 0) return { exitCode: migrated.exitCode, output: lines.join("\n") };
      schemaApplied = true;
    }
  } else {
    lines.push("No DATABASE_URL, so the schema isn't applied. Set it and run bogey db migrate.");
  }

  const createOrg = await prompter.confirm({
    message: schemaApplied
      ? "Create the first organization now?"
      : "Create the first organization now? The schema has to be applied first.",
    initial: schemaApplied,
  });
  if (createOrg) {
    const result = await runOrgInit(root, [], prompter);
    lines.push(result.output);
    if (result.exitCode !== 0) return { exitCode: result.exitCode, output: lines.join("\n") };
  } else {
    lines.push(
      "Most Bogey features are unavailable without an organization. Create one later with bogey org init",
    );
  }
  return { exitCode: 0, output: lines.join("\n") };
}
