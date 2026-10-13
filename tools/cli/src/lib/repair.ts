import { readFileSync } from "node:fs";
import { z } from "zod";
import { LOCK_TIMEOUT, type ProcessResult, type Runner } from "./migrations.ts";
import { schemaFiles } from "./schema.ts";

export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  const dollarTag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
  let current = "";
  let i = 0;

  const copyUntil = (end: string, from: number) => {
    const close = sql.indexOf(end, from);
    const stop = close === -1 ? sql.length : close + end.length;
    current += sql.slice(i, stop);
    i = stop;
  };

  while (i < sql.length) {
    const char = sql[i];
    if (sql.startsWith("--", i)) {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline;
    } else if (sql.startsWith("/*", i)) {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
    } else if (char === "'") {
      copyUntil("'", i + 1);
    } else if (char === '"') {
      copyUntil('"', i + 1);
    } else if (char === "$") {
      dollarTag.lastIndex = i;
      const tag = dollarTag.exec(sql);
      if (tag) copyUntil(tag[0], i + tag[0].length);
      else {
        current += char;
        i++;
      }
    } else if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i++;
    } else {
      current += char;
      i++;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function qualified(name: string): string {
  const plain = name.replace(/"/g, "").toLowerCase();
  return plain.includes(".") ? plain : `public.${plain}`;
}

function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      items.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(body.slice(start).trim());
  return items.filter(Boolean);
}

function parenthesized(text: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const TABLE_CONSTRAINT = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

export interface TableShape {
  name: string;
  columns: Map<string, string>;
}

export function parseTable(statement: string): TableShape | null {
  const match = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/i.exec(statement);
  if (!match) return null;
  const columns = new Map<string, string>();
  for (const item of topLevelItems(parenthesized(statement, match[0].length - 1))) {
    if (TABLE_CONSTRAINT.test(item)) continue;
    const name = /^("[^"]+"|\w+)/.exec(item)?.[1];
    if (name) columns.set(name.replace(/"/g, "").toLowerCase(), item);
  }
  return { name: qualified(match[1]!), columns };
}

export function parseEnum(statement: string): { name: string; labels: string[] } | null {
  const match = /^create\s+type\s+([\w."]+)\s+as\s+enum\s*\(([\s\S]*)\)$/i.exec(statement);
  if (!match) return null;
  const labels = [...match[2]!.matchAll(/'((?:[^']|'')*)'/g)].map((label) =>
    label[1]!.replace(/''/g, "'"),
  );
  return { name: qualified(match[1]!), labels };
}

export interface LiveSchema {
  tables: ReadonlySet<string>;
  columns: ReadonlySet<string>;
  enums: ReadonlyMap<string, Tuple<string>>;
}

const LIVE_QUERY = `select json_build_object(
  'tables', (select coalesce(json_agg(n.nspname || '.' || c.relname), '[]')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')),
  'columns', (select coalesce(json_agg(n.nspname || '.' || c.relname || '.' || a.attname), '[]')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and n.nspname not in ('pg_catalog', 'information_schema')),
  'enums', (select coalesce(json_agg(json_build_array(n.nspname || '.' || t.typname, e.enumlabel)
      order by n.nspname, t.typname, e.enumsortorder), '[]')
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace)
)`;

const LiveRows = z.object({
  tables: z.array(z.string()),
  columns: z.array(z.string()),
  enums: z.array(z.tuple([z.string(), z.string()])),
});

export function readLiveSchema(
  dbUrl: string,
  run: Runner,
): { ok: true; schema: LiveSchema } | { ok: false; error: string } {
  const result = run("psql", [dbUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", LIVE_QUERY]);
  if (result.status !== 0) {
    return { ok: false, error: result.stderr.trim() || "psql failed (is it installed?)" };
  }
  let json: unknown = null;
  try {
    json = JSON.parse(result.stdout.trim() || "null");
  } catch {}
  const parsed = LiveRows.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Couldn't read the database's catalog." };
  const enums = new Map<string, string[]>();
  for (const [type, label] of parsed.data.enums)
    enums.set(type, [...(enums.get(type) ?? []), label]);
  return {
    ok: true,
    schema: {
      tables: new Set(parsed.data.tables),
      columns: new Set(parsed.data.columns),
      enums,
    },
  };
}

export interface Constraint {
  table: string;
  name: string;
  type: string;
  definition: string;
}

export interface ConstraintSnapshot {
  compared: ReadonlySet<string>;
  wanted: Tuple<Constraint>;
  live: Tuple<Constraint>;
}

const SCRATCH = "bogey_repair_scratch";

const ADDS_CONSTRAINT =
  /^alter\s+table\s+(?:only\s+)?([\w."]+)\s+add\s+(?:constraint|primary|unique|check|foreign|exclude)\b/i;

export function constraintTable(statement: string): string | null {
  const match = ADDS_CONSTRAINT.exec(statement);
  return match ? qualified(match[1]!) : null;
}

export function scratchTable(statement: string): string | null {
  const name = parseTable(statement)?.name ?? constraintTable(statement);
  if (!name?.startsWith("public.")) return null;
  return statement
    .replace(
      /^((?:create\s+table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+(?:only\s+)?))[\w."]+/i,
      `$1${SCRATCH}.${name.slice("public.".length)}`,
    )
    .replace(/\breferences\s+(?:public\.)?("?[a-z_]\w*"?)(?![\w."])/gi, `references ${SCRATCH}.$1`);
}

const constraintRows = (namespace: string) => `(select coalesce(json_agg(json_build_array(
      'public.' || c.relname, k.conname, k.contype,
      replace(pg_get_constraintdef(k.oid), '${SCRATCH}.', ''))), '[]')
    from pg_constraint k join pg_class c on c.oid = k.conrelid
    where c.relnamespace = '${namespace}'::regnamespace and k.contype in ('c', 'f', 'u', 'x'))`;

const ConstraintRows = z.object({
  compared: z.array(z.string()),
  wanted: z.array(z.tuple([z.string(), z.string(), z.string(), z.string()])),
  live: z.array(z.tuple([z.string(), z.string(), z.string(), z.string()])),
});

export function readConstraints(
  dbUrl: string,
  run: Runner,
  statements: Tuple<string>,
): { ok: true; snapshot: ConstraintSnapshot } | { ok: false; error: string } {
  const tag = "$bogey_statement$";
  const tables = statements
    .map(scratchTable)
    .filter((sql): sql is string => sql !== null && !sql.includes(tag))
    .map(
      (sql) =>
        `do $bogey_repair$ begin execute ${tag}${sql}${tag}; exception when others then null; end $bogey_repair$;`,
    );
  const script = [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "set local client_min_messages = error;",
    LOCK_TIMEOUT,
    `create schema ${SCRATCH};`,
    ...tables,
    `select json_build_object(
  'compared', (select coalesce(json_agg('public.' || relname), '[]') from pg_class
    where relnamespace = '${SCRATCH}'::regnamespace and relkind in ('r', 'p')),
  'wanted', ${constraintRows(SCRATCH)},
  'live', ${constraintRows("public")}
);`,
    "rollback;",
  ].join("\n");
  const result = run("psql", [dbUrl, "-At", "-q", "-f", "-"], script);
  if (result.status !== 0) {
    return { ok: false, error: result.stderr.trim() || "psql failed (is it installed?)" };
  }
  let json: unknown = null;
  try {
    json = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("{")) ?? "null");
  } catch {}
  const parsed = ConstraintRows.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Couldn't read the database's constraints." };
  const toConstraint = ([table, name, type, definition]: [string, string, string, string]) => ({
    table,
    name,
    type,
    definition,
  });
  return {
    ok: true,
    snapshot: {
      compared: new Set(parsed.data.compared),
      wanted: parsed.data.wanted.map(toConstraint),
      live: parsed.data.live.map(toConstraint),
    },
  };
}

function identifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function constraintTarget(constraint: Constraint): string {
  const [schema, table] = constraint.table.split(".") as [string, string];
  return `${schema}.${identifier(table)}`;
}

const DROP_ORDER = ["f", "c", "u", "x"];
const ADD_ORDER = ["u", "x", "c", "f"];

const ADD_FAILURES = [
  "undefined_function",
  "datatype_mismatch",
  "undefined_column",
  "undefined_object",
  "undefined_table",
  "invalid_foreign_key",
  "unique_violation",
].join(" or ");

function reconcileConstraints(
  snapshot: ConstraintSnapshot,
  existing: ReadonlySet<string>,
): { drop: string[]; add: string[]; changes: string[] } {
  const key = (constraint: Constraint) => `${constraint.table}.${constraint.name}`;
  const inScope = (constraint: Constraint) =>
    snapshot.compared.has(constraint.table) && existing.has(constraint.table);
  const wanted = new Map(snapshot.wanted.filter(inScope).map((c) => [key(c), c]));
  const live = new Map(snapshot.live.filter(inScope).map((c) => [key(c), c]));
  const changes: string[] = [];

  const stale = [...live.values()].filter((constraint) => {
    const want = wanted.get(key(constraint));
    if (want?.definition === constraint.definition) return false;
    changes.push(
      `constraint ${key(constraint)} (${want ? "changed" : "not in supabase/schemas, dropped"})`,
    );
    return true;
  });
  const fresh = [...wanted.values()].filter((constraint) => {
    const have = live.get(key(constraint));
    if (have?.definition === constraint.definition) return false;
    if (!have) changes.push(`constraint ${key(constraint)}`);
    return true;
  });

  const byOrder = (order: Tuple<string>) => (a: Constraint, b: Constraint) =>
    order.indexOf(a.type) - order.indexOf(b.type);
  const drop = stale
    .sort(byOrder(DROP_ORDER))
    .map(
      (c) => `alter table ${constraintTarget(c)} drop constraint if exists ${identifier(c.name)}`,
    );
  const add = fresh.sort(byOrder(ADD_ORDER)).map((c) => {
    const target = constraintTarget(c);
    const name = identifier(c.name);
    const tag = "$bogey_statement$";
    const unvalidated = c.type === "c" || c.type === "f";
    const validate = unvalidated
      ? ` begin execute ${tag}alter table ${target} validate constraint ${name}${tag}; exception when check_violation or foreign_key_violation then raise warning ${literal(`${c.name} on ${c.table} holds for new rows only: existing ones break it (%). Fix them, then run repair again.`)}, sqlerrm; end;`
      : "";
    return `do $bogey_repair$ begin begin execute ${tag}alter table ${target} add constraint ${name} ${c.definition}${unvalidated ? " not valid" : ""}${tag}; exception when duplicate_object then return; when ${ADD_FAILURES} then raise warning ${literal(`${c.name} on ${c.table} was left off: % (a column's type may differ from supabase/schemas)`)}, sqlerrm; return; end;${validate} end $bogey_repair$`;
  });
  return { drop, add, changes };
}

function literal(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function ignoringDuplicates(sql: string): string {
  return `do $bogey_repair$ begin execute $bogey_statement$${sql}$bogey_statement$; exception when duplicate_object or duplicate_table or duplicate_schema then null; end $bogey_repair$`;
}

function replacingFunction(statement: string): string {
  const head = /^create\s+or\s+replace\s+(function|procedure)\s+([\w."]+)\s*\(/i.exec(statement);
  if (!head) return statement;
  const parameters = topLevelItems(parenthesized(statement, head[0].length - 1))
    .map((item) => item.replace(/\s+(default\b|=)[\s\S]*$/i, ""))
    .join(", ");
  const tag = "$bogey_statement$";
  if (statement.includes(tag)) return statement;
  return `do $bogey_repair$ begin execute ${tag}${statement}${tag}; exception when invalid_function_definition then execute ${tag}drop ${head[1]} ${head[2]}(${parameters})${tag}; execute ${tag}${statement}${tag}; end $bogey_repair$`;
}

export function rerunnable(statement: string): string[] {
  const rewrite = (pattern: RegExp, replacement: string) => [
    statement.replace(pattern, replacement),
  ];

  if (/^create\s+(or\s+replace\s+)?(function|procedure)\b/i.test(statement)) {
    return [
      replacingFunction(statement.replace(/^create\s+(or\s+replace\s+)?/i, "create or replace ")),
    ];
  }
  if (/^create\s+(or\s+replace\s+)?trigger\b/i.test(statement)) {
    return rewrite(/^create\s+(or\s+replace\s+)?/i, "create or replace ");
  }
  if (/^create\s+(or\s+replace\s+)?view\b/i.test(statement)) {
    return rewrite(/^create\s+(or\s+replace\s+)?/i, "create or replace ");
  }
  const policy = /^create\s+policy\s+(\S+)\s+on\s+(\S+)/i.exec(statement);
  if (policy) return [`drop policy if exists ${policy[1]} on ${policy[2]}`, statement];

  const ifNotExists =
    /^(create\s+(?:unique\s+)?index|create\s+schema|create\s+extension|create\s+sequence|create\s+materialized\s+view)\s+(?!if\s+not\s+exists)/i;
  if (ifNotExists.test(statement)) return rewrite(ifNotExists, "$1 if not exists ");

  if (/^insert\s+into\b/i.test(statement) && !/\bon\s+conflict\b/i.test(statement)) {
    return [`${statement}\non conflict do nothing`];
  }

  const publication = /^alter\s+publication\s+(\S+)\s+add\s+table\s+([\s\S]+)$/i.exec(statement);
  if (publication) {
    return topLevelItems(publication[2]!).map((table) =>
      ignoringDuplicates(`alter publication ${publication[1]} add table ${table}`),
    );
  }
  if (/^alter\s+table\b/i.test(statement)) {
    const columns = statement.replace(
      /\badd\s+column\s+(?!if\s+not\s+exists)/gi,
      "add column if not exists ",
    );
    return [/\badd\s+constraint\b/i.test(columns) ? ignoringDuplicates(columns) : columns];
  }
  if (/^create\s+type\b/i.test(statement)) return [ignoringDuplicates(statement)];
  return [statement];
}

export function staleOverloads(schemaStatements: Tuple<string>): string[] {
  const wanted = new Map<string, Set<number>>();
  for (const statement of schemaStatements) {
    const head = /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+([\w."]+)\s*\(/i.exec(
      statement,
    );
    if (!head) continue;
    const count = topLevelItems(parenthesized(statement, head[0].length - 1)).filter(
      (item) => !/^out\s/i.test(item.trim()),
    ).length;
    const name = qualified(head[1]!);
    wanted.set(name, (wanted.get(name) ?? new Set<number>()).add(count));
  }
  return [...wanted].map(([name, counts]) => {
    const [schema, routine] = name.split(".");
    return `do $bogey_repair$ declare stale record; begin for stale in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${literal(schema!)} and p.proname = ${literal(routine!)} and p.prokind in ('f', 'p') and p.pronargs <> all (array[${[...counts].join(", ")}]) loop execute 'drop routine ' || stale.signature; end loop; end $bogey_repair$`;
  });
}

export interface RepairPlan {
  enumLabels: string[];
  statements: string[];
  missing: string[];
  warnings: string[];
  rerun: number;
}

export function planRepair(
  schemaStatements: Tuple<string>,
  live: LiveSchema,
  constraints?: ConstraintSnapshot,
): RepairPlan {
  const plan: RepairPlan = { enumLabels: [], statements: [], missing: [], warnings: [], rerun: 0 };

  for (const statement of schemaStatements) {
    const table = parseTable(statement);
    if (table) {
      if (!live.tables.has(table.name)) {
        plan.missing.push(`table ${table.name}`);
        plan.statements.push(statement);
        continue;
      }
      for (const [column, definition] of table.columns) {
        if (live.columns.has(`${table.name}.${column}`)) continue;
        plan.missing.push(`column ${table.name}.${column}`);
        plan.statements.push(`alter table ${table.name} add column if not exists ${definition}`);
        if (
          /\bnot\s+null\b/i.test(definition) &&
          !/\b(default|generated|primary\s+key)\b/i.test(definition)
        ) {
          plan.warnings.push(
            `${table.name}.${column} is not null without a default, so adding it fails if the table has rows. Add it manually with a value for them.`,
          );
        }
      }
      const prefix = `${table.name}.`;
      for (const column of live.columns) {
        if (column.startsWith(prefix) && !table.columns.has(column.slice(prefix.length))) {
          plan.warnings.push(`${column} isn't in supabase/schemas; left alone.`);
        }
      }
      continue;
    }

    const enumType = parseEnum(statement);
    if (enumType) {
      const labels = live.enums.get(enumType.name);
      if (!labels) {
        plan.missing.push(`type ${enumType.name}`);
        plan.statements.push(statement);
        continue;
      }
      enumType.labels.forEach((label, index) => {
        if (labels.includes(label)) return;
        plan.missing.push(`${enumType.name} value '${label}'`);
        const before = enumType.labels[index - 1];
        plan.enumLabels.push(
          `alter type ${enumType.name} add value if not exists ${literal(label)}${before ? ` after ${literal(before)}` : ""}`,
        );
      });
      continue;
    }

    const altered = constraintTable(statement);
    if (constraints && altered && live.tables.has(altered)) continue;

    plan.statements.push(...rerunnable(statement));
    plan.rerun++;
  }
  plan.statements.push(...staleOverloads(schemaStatements));
  if (constraints) {
    const { drop, add, changes } = reconcileConstraints(constraints, live.tables);
    plan.statements = [...drop, ...plan.statements, ...add];
    plan.missing.push(...changes);
  }
  return plan;
}

export function schemaStatements(root: string): string[] {
  return schemaFiles(root).flatMap((path) => splitStatements(readFileSync(path, "utf-8")));
}

export function schemaDrift(
  root: string,
  dbUrl: string,
  run: Runner,
): { ok: true; missing: string[] } | { ok: false; error: string } {
  const live = readLiveSchema(dbUrl, run);
  if (!live.ok) return live;
  const statements = schemaStatements(root);
  const constraints = readConstraints(dbUrl, run, statements);
  return {
    ok: true,
    missing: planRepair(statements, live.schema, constraints.ok ? constraints.snapshot : undefined)
      .missing,
  };
}

export function describeDrift(missing: Tuple<string>): string {
  const shown = missing.slice(0, 4).join(", ");
  const more = missing.length > 4 ? ` and ${missing.length - 4} more` : "";
  return `The database differs from supabase/schemas in ${missing.length} thing(s) (${shown}${more}): run bogey db repair`;
}

export interface Script {
  text: string;
  lines: Array<[number, string]>;
}

export function buildScript(statements: Tuple<string>, transaction: boolean): Script {
  const head = transaction
    ? [
        "\\set ON_ERROR_STOP on",
        "begin;",
        "set local check_function_bodies = off;",
        "set local client_min_messages = warning;",
        LOCK_TIMEOUT,
      ]
    : ["\\set ON_ERROR_STOP on", "set client_min_messages = warning;"];
  const lines: Array<[number, string]> = [];
  let line = head.length + 1;
  const body = statements.map((statement) => {
    const chunk = `${statement};`;
    lines.push([line, statement]);
    line += chunk.split("\n").length;
    return chunk;
  });
  return { text: [...head, ...body, ...(transaction ? ["commit;"] : [])].join("\n"), lines };
}

export function describeFailure(script: Script, result: ProcessResult): string {
  const error =
    result.stderr
      .split("\n")
      .filter((line) => !/^psql:<stdin>:\d+: (NOTICE|WARNING):/.test(line))
      .join("\n")
      .trim() || "psql failed (is it installed?)";
  const line = Number(/psql:<stdin>:(\d+):\s*(?:ERROR|FATAL)/.exec(error)?.[1] ?? Number.NaN);
  const statement = script.lines.findLast(([start]) => start <= line)?.[1];
  return statement ? `${error}\n  in: ${statement.split("\n")[0]}` : error;
}
