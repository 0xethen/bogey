import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { busy } from "./activity.ts";

export const RELEASED_FILE = "RELEASED";

export interface Migration {
  version: string;
  name: string;
  path: string;
}

export function migrationsDir(root: string): string {
  return join(root, "supabase", "migrations");
}

export function migrationFiles(root: string): Migration[] {
  const dir = migrationsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ version: match[1]!, name: match[2]!, path: join(dir, match[0]) }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

export function releasedPath(root: string): string {
  return join(root, "supabase", RELEASED_FILE);
}

export function releasedVersion(root: string): string | null {
  const path = releasedPath(root);
  return existsSync(path) ? readFileSync(path, "utf-8").trim() || "unknown" : null;
}

export function migrationVersion(now: Date): string {
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}

export function migrationName(raw: string): string | null {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return name ? name.slice(0, 60) : null;
}

export function pending(files: Tuple<Migration>, applied: ReadonlySet<string>): Migration[] {
  return files.filter((file) => !applied.has(file.version));
}

export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type Runner = (command: string, args: string[], input?: string) => ProcessResult;

const POSTGRES_CLIENT =
  "It comes with the PostgreSQL client tools: `brew install libpq && brew link --force libpq` " +
  "on macOS, `apt install postgresql-client` on Debian or Ubuntu.";

export function notInstalled(command: string): string {
  const how = command === "psql" || command === "pg_dump" ? ` ${POSTGRES_CLIENT}` : "";
  return `${command} isn't installed (or isn't on your PATH).${how}`;
}

export const spawnRunner: Runner = (command, args, input) =>
  busy(`Running ${command}`, () => {
    const result = spawnSync(command, args, {
      input,
      encoding: "utf-8",
      maxBuffer: 1 << 30,
      env: { ...process.env, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "15" },
    });
    if (result.error) {
      const code = "code" in result.error ? result.error.code : undefined;
      if (code === "ENOENT") return { status: null, stdout: "", stderr: notInstalled(command) };
      if (result.status !== null || result.stderr) {
        return {
          status: result.status ?? 1,
          stdout: result.stdout ?? "",
          stderr: result.stderr?.trim() ? result.stderr : result.error.message,
        };
      }
      return { status: null, stdout: "", stderr: result.error.message };
    }
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  });

const TRACKING = `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);`;

const NOT_TRACKED = /(relation|schema) "supabase_migrations(\.\w+)?" does not exist/;

function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

export function appliedVersions(
  dbUrl: string,
  run: Runner,
): { ok: true; versions: Set<string> } | { ok: false; error: string } {
  const result = run("psql", [
    dbUrl,
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "select version from supabase_migrations.schema_migrations",
  ]);
  if (result.status === 0) {
    return { ok: true, versions: new Set(result.stdout.split("\n").filter(Boolean)) };
  }
  if (NOT_TRACKED.test(result.stderr)) return { ok: true, versions: new Set() };
  return { ok: false, error: result.stderr.trim() || "psql failed (is it installed?)" };
}

export const LOCK_TIMEOUT = "set local lock_timeout = '10s';";

const LOCK_CONFLICT =
  /deadlock detected|canceling statement due to lock timeout|could not obtain lock/;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function retryingLockConflicts(
  attempt: () => ProcessResult,
  attempts = 4,
  pause: (ms: number) => void = sleep,
): ProcessResult {
  let result = attempt();
  for (let tried = 1; tried < attempts && LOCK_CONFLICT.test(result.stderr); tried++) {
    pause(1000 * 2 ** (tried - 1));
    result = attempt();
  }
  return result;
}

export function applyMigration(dbUrl: string, migration: Migration, run: Runner): ProcessResult {
  const script = [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "set client_min_messages = warning;",
    LOCK_TIMEOUT,
    TRACKING,
    `\\i ${quote(migration.path)}`,
    `insert into supabase_migrations.schema_migrations (version, name) values (${quote(migration.version)}, ${quote(migration.name)});`,
    "commit;",
  ].join("\n");
  return retryingLockConflicts(() => run("psql", [dbUrl, "-q", "-f", "-"], script));
}

export function markApplied(
  dbUrl: string,
  migrations: Tuple<Migration>,
  run: Runner,
): ProcessResult {
  const rows = migrations
    .map((migration) => `(${quote(migration.version)}, ${quote(migration.name)})`)
    .join(", ");
  const script = [
    "\\set ON_ERROR_STOP on",
    TRACKING,
    `insert into supabase_migrations.schema_migrations (version, name) values ${rows} on conflict do nothing;`,
  ].join("\n");
  return run("psql", [dbUrl, "-q", "-f", "-"], script);
}

export interface PluginMigration {
  plugin: string;
  version: string;
  name: string;
  path: string;
}

export function pluginMigrationFiles(pluginDir: string, plugin: string): PluginMigration[] {
  const dir = join(pluginDir, "migrations");
  if (!existsSync(dir)) {
    const schema = join(pluginDir, "schema.sql");
    return existsSync(schema) ? [{ plugin, version: "0", name: "schema", path: schema }] : [];
  }
  return readdirSync(dir)
    .map((file) => /^(\d+)_([a-z0-9_]+)\.sql$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ plugin, version: match[1]!, name: match[2]!, path: join(dir, match[0]) }))
    .sort((a, b) => Number(a.version) - Number(b.version));
}

const PLUGIN_TRACKING = `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.plugin_migrations (
  plugin text not null,
  version text not null,
  name text not null,
  applied_at timestamptz not null default now(),
  primary key (plugin, version)
);
alter table supabase_migrations.plugin_migrations add column if not exists checksum text;`;

export function checksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function appliedPluginVersions(
  dbUrl: string,
  run: Runner,
): { ok: true; versions: Map<string, string> } | { ok: false; error: string } {
  const result = run("psql", [
    dbUrl,
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "select plugin || ':' || version || '|' || coalesce(to_jsonb(m) ->> 'checksum', '') from supabase_migrations.plugin_migrations m",
  ]);
  if (result.status === 0) {
    const versions = new Map<string, string>();
    for (const line of result.stdout.split("\n").filter(Boolean)) {
      const bar = line.lastIndexOf("|");
      if (bar === -1) versions.set(line, "");
      else versions.set(line.slice(0, bar), line.slice(bar + 1));
    }
    return { ok: true, versions };
  }
  if (NOT_TRACKED.test(result.stderr)) return { ok: true, versions: new Map() };
  return { ok: false, error: result.stderr.trim() || "psql failed (is it installed?)" };
}

export function pendingPluginMigrations(
  files: Tuple<PluginMigration>,
  applied: ReadonlyMap<string, string>,
): PluginMigration[] {
  return files.filter((file) => !applied.has(`${file.plugin}:${file.version}`));
}

export function changedPluginMigrations(
  files: Tuple<PluginMigration>,
  applied: ReadonlyMap<string, string>,
): PluginMigration[] {
  return files.filter((file) => {
    const recorded = applied.get(`${file.plugin}:${file.version}`);
    return recorded !== undefined && recorded !== "" && recorded !== checksum(file.path);
  });
}

export interface PluginMigrationContext {
  requires: Tuple<string>;
  shared: Readonly<Record<string, Tuple<string>>>;
}

export const NO_CONTEXT: PluginMigrationContext = { requires: [], shared: {} };

export function pluginMigrationScript(
  migration: PluginMigration,
  context: PluginMigrationContext,
  body: string,
): string {
  const requires = `array[${context.requires.map(quote).join(", ")}]::text[]`;
  return [
    "begin isolation level repeatable read;",
    "set client_min_messages = warning;",
    LOCK_TIMEOUT,
    PLUGIN_TRACKING,
    `select private.plugin_migration_begin(${quote(migration.plugin)});`,
    body,
    `select private.plugin_migration_end(${quote(migration.plugin)}, ${requires}, ${quote(JSON.stringify(context.shared))}::jsonb);`,
    `insert into supabase_migrations.plugin_migrations (plugin, version, name, checksum) values (${quote(migration.plugin)}, ${quote(migration.version)}, ${quote(migration.name)}, ${quote(checksum(migration.path))});`,
    "commit;",
  ].join("\n");
}

export function applyPluginMigration(
  dbUrl: string,
  migration: PluginMigration,
  run: Runner,
  context: PluginMigrationContext = NO_CONTEXT,
): ProcessResult {
  const script = [
    "\\set ON_ERROR_STOP on",
    pluginMigrationScript(migration, context, `\\i ${quote(migration.path)}`),
  ].join("\n");
  return retryingLockConflicts(() => run("psql", [dbUrl, "-q", "-f", "-"], script));
}
