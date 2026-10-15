import { readFileSync } from "node:fs";
import { busy } from "./activity.ts";
import { REQUEST_TIMEOUT_MS, type Credentials } from "./credentials.ts";
import type { PluginMigration, ProcessResult, Runner } from "./migrations.ts";

export interface NamedObject {
  kind:
    | "schema"
    | "type"
    | "relation"
    | "function"
    | "policy"
    | "trigger"
    | "publication relation"
    | "cron job"
    | "storage bucket";
  schema?: string;
  name: string;
  table?: string;
}

const ORDER: Tuple<NamedObject["kind"]> = [
  "schema",
  "type",
  "relation",
  "function",
  "policy",
  "trigger",
  "publication relation",
  "cron job",
  "storage bucket",
];

const IDENT = String.raw`"?([A-Za-z_][A-Za-z0-9_$]*)"?`;
const QUALIFIED = String.raw`(?:${IDENT}\.)?${IDENT}`;

function pattern(source: string): RegExp {
  return new RegExp(source, "gi");
}

export function namedObjects(sql: string): NamedObject[] {
  const text = sql.replace(/--[^\n]*/g, "");
  const found: NamedObject[] = [];
  const add = (object: NamedObject) => {
    const same = found.some(
      (each) =>
        each.kind === object.kind &&
        each.schema === object.schema &&
        each.name === object.name &&
        each.table === object.table,
    );
    if (!same) found.push(object);
  };
  const schemaOf = (schema: string | undefined) => (schema ?? "public").toLowerCase();

  for (const match of text.matchAll(
    pattern(String.raw`create\s+schema\s+(?:if\s+not\s+exists\s+)?${IDENT}`),
  )) {
    add({ kind: "schema", name: match[1]!.toLowerCase() });
  }
  for (const match of text.matchAll(pattern(String.raw`create\s+(?:type|domain)\s+${QUALIFIED}`))) {
    add({ kind: "type", schema: schemaOf(match[1]), name: match[2]!.toLowerCase() });
  }
  for (const match of text.matchAll(
    pattern(
      String.raw`create\s+(?:or\s+replace\s+)?(?:unlogged\s+)?(?:materialized\s+)?(?:table|view|sequence)\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`,
    ),
  )) {
    add({ kind: "relation", schema: schemaOf(match[1]), name: match[2]!.toLowerCase() });
  }
  for (const match of text.matchAll(
    pattern(
      String.raw`create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${IDENT}\s+on\s+(?:only\s+)?${QUALIFIED}`,
    ),
  )) {
    add({ kind: "relation", schema: schemaOf(match[2]), name: match[1]!.toLowerCase() });
  }
  for (const match of text.matchAll(
    pattern(String.raw`create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${QUALIFIED}\s*\(`),
  )) {
    add({ kind: "function", schema: schemaOf(match[1]), name: match[2]!.toLowerCase() });
  }
  for (const match of text.matchAll(
    pattern(String.raw`create\s+policy\s+${IDENT}\s+on\s+${QUALIFIED}`),
  )) {
    add({
      kind: "policy",
      schema: schemaOf(match[2]),
      table: match[3]!.toLowerCase(),
      name: match[1]!,
    });
  }
  for (const match of text.matchAll(
    pattern(
      String.raw`create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+${IDENT}\s[^;]*?\bon\s+${QUALIFIED}`,
    ),
  )) {
    add({
      kind: "trigger",
      schema: schemaOf(match[2]),
      table: match[3]!.toLowerCase(),
      name: match[1]!,
    });
  }
  for (const match of text.matchAll(
    pattern(String.raw`alter\s+publication\s+${IDENT}\s+add\s+table\s+([^;]+)`),
  )) {
    for (const table of match[2]!.matchAll(new RegExp(QUALIFIED, "g"))) {
      add({
        kind: "publication relation",
        name: match[1]!,
        schema: schemaOf(table[1]),
        table: table[2]!.toLowerCase(),
      });
    }
  }
  for (const match of text.matchAll(pattern(String.raw`cron\.schedule\(\s*'([^']+)'`))) {
    add({ kind: "cron job", name: match[1]! });
  }
  for (const match of text.matchAll(
    pattern(String.raw`insert\s+into\s+storage\.buckets\s*\(\s*id\b[^)]*\)\s*values\s*([^;]*)`),
  )) {
    for (const row of match[1]!.matchAll(/\(\s*'([^']+)'/g)) {
      add({ kind: "storage bucket", name: row[1]! });
    }
  }

  return found.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

export function namedObjectsIn(files: Tuple<PluginMigration>): NamedObject[] {
  const all = files.flatMap((file) => namedObjects(readFileSync(file.path, "utf-8")));
  const seen = new Set<string>();
  return all
    .filter((object) => {
      const id = JSON.stringify(object);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

export function quote(text: string): string {
  const body = text.replace(/'/g, "''");
  return text.includes("\\") ? `E'${body.replace(/\\/g, "\\\\")}'` : `'${body}'`;
}

export function adoptStatement(plugin: string, objects: Tuple<NamedObject> | null): string {
  if (objects) {
    return `create temp table bogey_adopted on commit drop as select * from private.plugin_adopt(${quote(plugin)}, ${quote(JSON.stringify(objects))}::jsonb) a(line);`;
  }
  const prefix = `${plugin.replace(/-/g, "_")}_`.replace(/[\\_]/g, "\\$&");
  const like = quote(`${prefix}%`);
  return `create temp table bogey_adopted on commit drop as select * from private.plugin_adopt(${quote(plugin)}, (
  select coalesce(jsonb_agg(o), '[]') from (
    select 'relation' as kind, n.nspname as schema, c.relname as name, null as "table"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname like ${like}
    union all
    select 'function', n.nspname, p.proname, null
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname like ${like}
    union all
    select 'type', n.nspname, t.typname, null
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public', 'private') and t.typtype in ('e', 'd') and t.typname like ${like}
    union all
    select 'policy', n.nspname, p.polname, c.relname
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where p.polname like ${like}
    union all
    select 'trigger', n.nspname, t.tgname, c.relname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and t.tgname like ${like}
    union all
    select 'cron job', null, j.jobname, null from cron.job j
    where j.jobname = ${quote(`bogey-${plugin}`)} or j.jobname like ${quote(`bogey-${plugin}-%`.replace(/[\\_]/g, "\\$&"))}
    union all
    select 'storage bucket', null, b.id, null from storage.buckets b where b.id = ${quote(plugin)}
  ) o)) a(line);`;
}

export interface RemovalPlan {
  objects: string[];
  blockers: string[];
  rows: string[];
  buckets: { id: string; files: number }[];
  adopted: string[];
  migrations: number;
}

export function removalPlan(
  url: string,
  plugin: string,
  adopt: string | null,
  run: Runner,
): { ok: true; plan: RemovalPlan } | { ok: false; error: string } {
  const key = quote(plugin);
  const script = [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "set client_min_messages = warning;",
    adopt ?? "create temp table bogey_adopted (line text) on commit drop;",
    "select 'adopted', line from bogey_adopted;",
    `select 'object', kind || ' ' || identity from private.plugin_objects where plugin = ${key} order by seq;`,
    `select 'blocker', identity || ' ' || problem from private.plugin_removal(${key}) where problem is not null and problem <> 'already gone';`,
    `select 'bucket', b.identity || ' ' || (select count(*) from storage.objects o where o.bucket_id = b.identity) from private.plugin_objects b where b.plugin = ${key} and b.kind = 'storage bucket';`,
    `do $$ begin if to_regclass('supabase_migrations.plugin_migrations') is null then create temp table bogey_plugin_migrations (plugin text) on commit drop; else create temp view bogey_plugin_migrations as select plugin from supabase_migrations.plugin_migrations; end if; end $$;`,
    `select 'migrations', count(*) from bogey_plugin_migrations where plugin = ${key};`,
    `select 'row', line from private.plugin_purge(${key}) p(line);`,
    "rollback;",
  ].join("\n");
  const result = run("psql", [url, "-At", "-q", "-F", "\t", "-f", "-"], script);
  if (result.status !== 0) return { ok: false, error: explainPsql(result) };

  const plan: RemovalPlan = {
    objects: [],
    blockers: [],
    rows: [],
    buckets: [],
    adopted: [],
    migrations: 0,
  };
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const tab = line.indexOf("\t");
    const what = line.slice(0, tab);
    const value = line.slice(tab + 1);
    if (what === "adopted") plan.adopted.push(value);
    else if (what === "object") plan.objects.push(value);
    else if (what === "blocker") plan.blockers.push(value);
    else if (what === "row") plan.rows.push(value);
    else if (what === "migrations") plan.migrations = Number(value);
    else if (what === "bucket") {
      const space = value.lastIndexOf(" ");
      const files = Number(value.slice(space + 1));
      if (files > 0) plan.buckets.push({ id: value.slice(0, space), files });
    }
  }
  return { ok: true, plan };
}

export function removeFromDatabase(
  url: string,
  plugin: string,
  adopt: string | null,
  run: Runner,
): ProcessResult {
  const script = [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "set client_min_messages = warning;",
    "set local lock_timeout = '10s';",
    ...(adopt ? [adopt] : []),
    `select * from private.plugin_remove(${quote(plugin)});`,
    "commit;",
  ].join("\n");
  return run("psql", [url, "-At", "-q", "-f", "-"], script);
}

export function pluginsInDatabase(
  url: string,
  run: Runner,
):
  | { ok: true; plugins: Map<string, { objects: number; migrations: number }> }
  | { ok: false; error: string } {
  const script = [
    "\\set ON_ERROR_STOP on",
    `do $$ begin if to_regclass('supabase_migrations.plugin_migrations') is null then create temp table bogey_plugin_migrations (plugin text); else create temp view bogey_plugin_migrations as select plugin from supabase_migrations.plugin_migrations; end if; end $$;`,
    `select plugin, sum(objects), sum(migrations) from (
       select plugin, 1 as objects, 0 as migrations from private.plugin_objects
       union all select plugin, 0, 1 from bogey_plugin_migrations
     ) t group by plugin order by plugin;`,
  ].join("\n");
  const result = run("psql", [url, "-At", "-q", "-F", "\t", "-f", "-"], script);
  if (result.status !== 0) return { ok: false, error: explainPsql(result) };
  const plugins = new Map<string, { objects: number; migrations: number }>();
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const [key = "", objects = "0", migrations = "0"] = line.split("\t");
    plugins.set(key, { objects: Number(objects), migrations: Number(migrations) });
  }
  return { ok: true, plugins };
}

const NOT_SET_UP =
  /private\.plugin_(objects|migration_begin|adopt|remove|removal|purge)|relation "private\.plugin_objects" does not exist/;

export function explainPsql(result: ProcessResult): string {
  const error = result.stderr.trim() || "psql failed (is it installed?)";
  return NOT_SET_UP.test(error) && /does not exist/.test(error)
    ? `${error}\nThis database doesn't record plugin objects yet. Apply Bogey's schema first: bogey db migrate.`
    : error;
}

export async function emptyBucket(
  credentials: Credentials,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return busy(`Empty storage bucket ${id}`, async () => {
    try {
      const response = await fetch(
        `${credentials.url}/storage/v1/bucket/${encodeURIComponent(id)}/empty`,
        {
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            apikey: credentials.serviceKey,
            authorization: `Bearer ${credentials.serviceKey}`,
          },
        },
      );
      if (response.ok) return { ok: true };
      return {
        ok: false,
        error: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
      };
    } catch (error) {
      return { ok: false, error: `Couldn't reach ${credentials.url}: ${String(error)}` };
    }
  });
}
