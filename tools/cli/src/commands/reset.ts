import { step } from "../lib/activity.ts";
import type { Prompter } from "../lib/prompt.ts";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import { databaseUrl, NO_DATABASE_URL } from "../lib/credentials.ts";
import {
  markApplied,
  migrationFiles,
  spawnRunner,
  type Migration,
  type Runner,
} from "../lib/migrations.ts";
import { parseFlags } from "../lib/flags.ts";
import { migrateBundledPlugins } from "./plugins.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey reset [--db-url <postgres url>] [--out <dir>] [--yes]

Puts a database back to factory default: every user, organization, event and row
is deleted, then the baseline in supabase/migrations is applied fresh.

First it writes a full pg_dump (custom format) to <dir>/pre-reset.dump, and stops
if that fails; a reset never runs without one. Then it asks you to type "reset".
--yes skips only that question, for scripts; the dump is still made.
<dir> defaults to backups/reset-<timestamp>. --db-url defaults to DATABASE_URL (from the environment or .env).
Needs pg_dump and psql. Storage objects are not touched.

To undo: pg_restore --clean --if-exists --no-owner -d <url> <dir>/pre-reset.dump`;

export type Ask = (question: string, hint: string) => Promise<string>;

export function askWith(prompter: Prompter | null): Ask | null {
  return prompter ? (message, hint) => prompter.text({ message, hint, optional: true }) : null;
}

const CLEAR = `
drop trigger if exists auth_users_strip_password on auth.users;
drop trigger if exists auth_users_handle_new_user on auth.users;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
do $$ declare r record; begin
  for r in select jobname from cron.job where jobname like 'bogey-%' loop
    perform cron.unschedule(r.jobname);
  end loop;
exception when undefined_table or invalid_schema_name then null;
end $$;
drop schema if exists private cascade;
drop schema if exists tests cascade;
do $$ declare r record; begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v','m') loop
    execute format('drop view if exists public.%I cascade', r.relname);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
  for r in select typname from pg_type where typnamespace = 'public'::regnamespace and typtype = 'e' loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;
delete from auth.users;
-- the plugins' tables went with public, so their migrations have to run again
do $$ begin
  delete from supabase_migrations.plugin_migrations;
exception when undefined_table or invalid_schema_name then null;
end $$;
`;

function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function failure(label: string, stderr: string): CliResult {
  return { exitCode: 1, output: `bogey reset: ${label}\n${stderr.trim()}`.trim() };
}

export async function runReset(
  cwd: string,
  args: string[],
  run: Runner = spawnRunner,
  ask: Ask | null = null,
  now: () => Date = () => new Date(),
): Promise<CliResult> {
  if (args.includes("--help")) return { exitCode: 0, output: USAGE };
  const flags = parseFlags(args);
  const url = databaseUrl(cwd, flags["db-url"]);
  if (!url) return { exitCode: 1, output: NO_DATABASE_URL };

  const root = findRepoRoot(cwd);
  const baselines: Migration[] = migrationFiles(root);
  if (!baselines.length) return { exitCode: 1, output: `No migrations in ${root}/supabase.` };

  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const out = resolve(
    cwd,
    typeof flags.out === "string" ? flags.out : join("backups", `reset-${stamp}`),
  );
  const dump = join(out, "pre-reset.dump");
  mkdirSync(out, { recursive: true });

  const dumped = step("Dump the database first", () =>
    run("pg_dump", [url, "--format=custom", `--file=${dump}`]),
  );
  if (dumped.status !== 0) {
    return failure(
      `no dump was made, so nothing was changed. ${dumped.status === null ? "Is pg_dump installed?" : ""}`,
      dumped.stderr,
    );
  }

  if (!args.includes("--yes")) {
    if (!ask) {
      return {
        exitCode: 1,
        output: `Dump written to ${dump}. Not a terminal: pass --yes to reset without being asked.`,
      };
    }
    const where = run("psql", [
      url,
      "-At",
      "-c",
      "select current_database() || ' on ' || coalesce(inet_server_addr()::text, 'a local socket')",
    ]);
    const answer = await ask(
      `Type "reset" to delete ALL data in ${where.stdout.trim() || "this database"}`,
      `A dump is at ${dump}. Anything else cancels.`,
    );
    if (answer.trim() !== "reset") {
      return { exitCode: 1, output: "Cancelled. Nothing was changed." };
    }
  }

  const [baseline] = baselines;
  const script = [
    "\\set ON_ERROR_STOP on",
    "begin;",
    CLEAR,
    `\\i ${quote(baseline!.path)}`,
    "commit;",
  ].join("\n");
  const reset = step("Clear the database and apply the baseline", () =>
    run("psql", [url, "-q", "-f", "-"], script),
  );
  if (reset.status !== 0) {
    return failure(`the reset failed and was rolled back. Your dump is ${dump}.`, reset.stderr);
  }
  const marked = markApplied(url, [baseline!], run);
  if (marked.status !== 0)
    return failure("couldn't record the baseline as applied.", marked.stderr);
  const bundled = migrateBundledPlugins(cwd, url, run);
  if (!bundled.ok) return failure("the plugins that ship with Bogey didn't apply.", bundled.error);

  return {
    exitCode: 0,
    output: `✓ Reset to factory default. Dump: ${dump}\nRun \`bogey db migrate\` if later migrations exist, then \`bogey org init\`.`,
  };
}
