import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  databaseUrl,
  DOWNLOAD_TIMEOUT_MS,
  serviceCredentials,
  type Credentials,
} from "../lib/credentials.ts";
import { step } from "../lib/activity.ts";
import { notInstalled } from "../lib/migrations.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey backup [--out <dir>] [--db-url <postgres url>]

Copies every Storage object into <dir>/storage/<bucket>/... through the Storage
API (service key from .env). With a database URL (--db-url, or DATABASE_URL
from the environment or .env), also writes <dir>/data.sql: a pg_dump of the
public, auth and storage schemas' data (needs pg_dump).

To restore: apply supabase/migrations to a fresh Supabase, run data.sql with
psql (rows that already exist are skipped), then upload the storage folder.
<dir> defaults to backups/<timestamp>.`;

interface StorageEntry {
  name: string;
  id: string | null;
}

async function storageCall(credentials: Credentials, path: string, init: RequestInit = {}) {
  return fetch(`${credentials.url}/storage/v1${path}`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    ...init,
    headers: {
      apikey: credentials.serviceKey,
      authorization: `Bearer ${credentials.serviceKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function listObjects(
  credentials: Credentials,
  bucket: string,
  prefix = "",
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await storageCall(credentials, `/object/list/${bucket}`, {
      method: "POST",
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!response.ok) throw new Error(`listing ${bucket}/${prefix}: HTTP ${response.status}`);
    const entries = (await response.json()) as StorageEntry[];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) paths.push(path);
      else paths.push(...(await listObjects(credentials, bucket, path)));
    }
    if (entries.length < 1000) return paths;
  }
}

async function backupStorage(credentials: Credentials, out: string): Promise<string> {
  const response = await storageCall(credentials, "/bucket");
  if (!response.ok) throw new Error(`listing buckets: HTTP ${response.status}`);
  const buckets = (await response.json()) as { id: string }[];
  let files = 0;
  for (const bucket of buckets) {
    for (const path of await listObjects(credentials, bucket.id)) {
      const file = await storageCall(credentials, `/object/${bucket.id}/${path}`);
      if (!file.ok) throw new Error(`downloading ${bucket.id}/${path}: HTTP ${file.status}`);
      const target = join(out, "storage", bucket.id, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(await file.arrayBuffer()));
      files++;
    }
  }
  return `${files} ${files === 1 ? "file" : "files"} from ${buckets.length} buckets`;
}

function backupDatabase(dbUrl: string, out: string): string {
  const target = join(out, "data.sql");
  const result = spawnSync(
    "pg_dump",
    [
      dbUrl,
      "--data-only",
      "--no-owner",
      "--no-privileges",
      "--column-inserts",
      "--on-conflict-do-nothing",
      "--schema=public",
      "--schema=auth",
      "--schema=storage",
      `--file=${target}`,
    ],
    { encoding: "utf-8" },
  );
  if (result.error) {
    throw new Error(
      `${notInstalled("pg_dump")} Use a version at least as new as your database's, or unset DATABASE_URL to back up files only.`,
    );
  }
  if (result.status !== 0) throw new Error(`pg_dump failed:\n${result.stderr}`);
  return target;
}

export async function runBackup(cwd: string, args: string[]): Promise<CliResult> {
  if (args.includes("--help")) return { exitCode: 0, output: USAGE };
  const flags = parseFlags(args);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = resolve(cwd, typeof flags.out === "string" ? flags.out : join("backups", stamp));

  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };

  try {
    mkdirSync(out, { recursive: true });
    const lines = [`✓ Backed up to ${out}`];
    const dbUrl = databaseUrl(cwd, flags["db-url"]);
    if (dbUrl) {
      lines.push(`  database: ${step("Dump the database", () => backupDatabase(dbUrl, out))}`);
    }
    const storage = await step("Copy Storage files", () =>
      backupStorage(resolved.credentials, out),
    );
    lines.push(`  storage: ${storage}`);
    return { exitCode: 0, output: lines.join("\n") };
  } catch (error) {
    return {
      exitCode: 1,
      output: `bogey backup: the backup in ${out} is incomplete.\n${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
