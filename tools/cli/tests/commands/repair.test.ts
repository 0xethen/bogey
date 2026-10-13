import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import { runRepair } from "../../src/commands/repair.ts";
import {
  planRepair,
  rerunnable,
  scratchTable,
  splitStatements,
  type ConstraintSnapshot,
  type LiveSchema,
} from "../../src/lib/repair.ts";
import type { ProcessResult, Runner } from "../../src/lib/migrations.ts";
import { scripted } from "../support/prompter.ts";

const SCHEMA = `-- events
create type public.event_kind as enum ('hackathon', 'contest', 'custom');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  -- a comment, with a comma
  name text not null check (length(name) between 1 and 120),
  kind public.event_kind not null default 'hackathon',
  short_name text,
  unique (name)
);
create index events_name_idx on public.events (name);

create function private.touch() returns trigger language plpgsql as $$
begin
  new.name := 'a;b'; -- not the end
  return new;
end;
$$;

create policy events_select on public.events for select to anon using (true);
insert into public.role_permissions (role_key, permission) values ('judge', 'event.view');
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-repair-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(root, "supabase", "schemas"), { recursive: true });
  mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(root, "supabase", "schemas", "01_events.sql"), SCHEMA);
  writeFileSync(join(root, "supabase", "migrations", "20260924000000_baseline.sql"), "");
});

const OLD = {
  tables: ["public.events", "public.legacy"],
  columns: [
    "public.events.id",
    "public.events.name",
    "public.events.kind",
    "public.events.old_col",
  ],
  enums: [
    ["public.event_kind", "hackathon"],
    ["public.event_kind", "contest"],
  ],
};

const NO_CONSTRAINTS = { compared: [], wanted: [], live: [] };

function fakePsql(live: object, fail?: string, constraints: object = NO_CONSTRAINTS, stderr = "") {
  const scripts: string[] = [];
  const run: Runner = (command, args, input): ProcessResult => {
    if (command !== "psql") return { status: 1, stdout: "", stderr: `${command}: not found` };
    if (args.includes("-c")) return { status: 0, stdout: JSON.stringify(live), stderr: "" };
    if (input?.includes("create schema bogey_repair_scratch")) {
      return { status: 0, stdout: `${JSON.stringify(constraints)}\n`, stderr: "" };
    }
    scripts.push(input ?? "");
    if (fail && input?.includes("begin;")) return { status: 3, stdout: "", stderr: fail };
    return { status: 0, stdout: "", stderr };
  };
  return { run, scripts };
}

const live = (): LiveSchema => ({
  tables: new Set(OLD.tables),
  columns: new Set(OLD.columns),
  enums: new Map([["public.event_kind", ["hackathon", "contest"]]]),
});

test("statements split on top-level semicolons only, without comments", () => {
  const statements = splitStatements(SCHEMA);
  expect(statements).toHaveLength(6);
  expect(statements[3]).toContain("'a;b'; -- not the end");
  expect(statements.join("\n")).not.toContain("-- events");
});

test("the plan adds missing columns and enum values, and leaves extra ones alone", () => {
  const plan = planRepair(splitStatements(SCHEMA), live());
  expect(plan.missing).toEqual([
    "public.event_kind value 'custom'",
    "column public.events.short_name",
  ]);
  expect(plan.enumLabels).toEqual([
    "alter type public.event_kind add value if not exists 'custom' after 'contest'",
  ]);
  expect(plan.statements).toContain(
    "alter table public.events add column if not exists short_name text",
  );
  expect(plan.warnings).toEqual(["public.events.old_col isn't in supabase/schemas; left alone."]);
  expect(plan.statements.join("\n")).not.toMatch(/\bdrop (table|column)\b/);
});

test("the plan drops older signatures of a function whose parameters changed", () => {
  const plan = planRepair(
    splitStatements(
      "create function public.import_roster(p_event uuid, p_notify boolean default false) returns void language sql as 'select 1';",
    ),
    live(),
  );
  const drop = plan.statements.find((statement) => statement.includes("drop routine"));
  expect(drop).toContain("p.proname = 'import_roster'");
  expect(drop).toContain("<> all (array[2])");
});

test("an array default's commas don't count as parameters", () => {
  const plan = planRepair(
    splitStatements(
      "create function public.clone_event(p_source uuid, p_include text[] default array['details', 'windows']) returns void language sql as 'select 1';",
    ),
    live(),
  );
  const drop = plan.statements.find((statement) => statement.includes("drop routine"));
  expect(drop).toContain("<> all (array[2])");
});

test("a missing table is created as written", () => {
  const plan = planRepair(splitStatements(SCHEMA), { ...live(), tables: new Set() });
  expect(plan.missing).toContain("table public.events");
  expect(plan.statements.some((sql) => sql.startsWith("create table public.events ("))).toBe(true);
});

test("a not-null column without a default is flagged", () => {
  const plan = planRepair(
    ["create table public.events (id uuid primary key, slug text not null)"],
    {
      tables: new Set(["public.events"]),
      columns: new Set(["public.events.id"]),
      enums: new Map(),
    },
  );
  expect(plan.warnings[0]).toMatch(/slug is not null without a default/);
});

test("statements are rewritten to rerun cleanly", () => {
  expect(
    rerunnable("create function private.f() returns int language sql as $$ select 1 $$")[0],
  ).toMatch(/execute \$bogey_statement\$create or replace function/);
  expect(
    rerunnable("create trigger t before update on public.x for each row execute function f()")[0],
  ).toMatch(/^create or replace trigger/);
  expect(rerunnable("create unique index i on public.x (a)")).toEqual([
    "create unique index if not exists i on public.x (a)",
  ]);
  expect(rerunnable("create policy p on public.x for select using (true)")).toEqual([
    "drop policy if exists p on public.x",
    "create policy p on public.x for select using (true)",
  ]);
  expect(rerunnable("insert into public.x (a) values (1)")[0]).toMatch(/on conflict do nothing$/);
  const publication = rerunnable(
    "alter publication supabase_realtime add table public.a, public.b",
  );
  expect(publication).toHaveLength(2);
  expect(publication[1]).toMatch(/add table public\.b.*duplicate_object/);
  expect(rerunnable("grant execute on function private.f() to authenticated")).toEqual([
    "grant execute on function private.f() to authenticated",
  ]);
});

test("a function whose return type changed is dropped and created again", () => {
  const [sql] = rerunnable(
    "create function public.view(p_token text, p_limit int default 5, out name text) returns setof record language sql as $$ select 'a' $$",
  );
  expect(sql).toContain("exception when invalid_function_definition");
  expect(sql).toContain(
    "drop function public.view(p_token text, p_limit int, out name text)$bogey_statement$",
  );
});

test("--dry-run reports without writing", async () => {
  const { run, scripts } = fakePsql(OLD);
  const result = await runRepair(root, ["--dry-run", "--db-url", "postgres://x"], run);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("+ column public.events.short_name");
  expect(scripts).toEqual([]);
});

test("repair adds enum values first, then the rest in one transaction recording the baseline", async () => {
  const { run, scripts } = fakePsql(OLD);
  const result = await runRepair(root, ["--db-url", "postgres://x"], run);
  expect(result.exitCode).toBe(0);
  expect(scripts).toHaveLength(2);
  expect(scripts[0]).toContain("add value if not exists 'custom'");
  expect(scripts[0]).not.toContain("begin;");
  expect(scripts[1]).toMatch(/^\\set ON_ERROR_STOP on\nbegin;[\s\S]*commit;$/);
  expect(scripts[1]).toContain("values ('20260924000000', 'baseline') on conflict do nothing");
});

test("once released, repair leaves migration records to bogey db migrate", async () => {
  writeFileSync(join(root, "supabase", "RELEASED"), "v1.0.0\n");
  const { run, scripts } = fakePsql(OLD);
  await runRepair(root, ["--db-url", "postgres://x"], run);
  expect(scripts[1]).not.toContain("schema_migrations");
});

test("a failure names the statement it came from, past any notices", async () => {
  const { run } = fakePsql(
    OLD,
    'psql:<stdin>:2: NOTICE:  relation "x" already exists, skipping\npsql:<stdin>:6: ERROR:  boom',
  );
  const result = await runRepair(root, ["--db-url", "postgres://x"], run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("rolled back");
  expect(result.output).toContain(
    "in: alter table public.events add column if not exists short_name",
  );
  expect(result.output).not.toContain("NOTICE");
});

test("at a terminal it shows the plan and asks before changing anything", async () => {
  const { run, scripts } = fakePsql(OLD);
  const { prompter, said, asked } = scripted([false]);
  const result = await runRepair(root, ["--db-url", "postgres://x/db"], run, prompter);
  // eslint-disable-next-line no-control-regex
  expect(said[0]?.replace(/\u001b\[[0-9;]*m/g, "")).toContain("+ column public.events.short_name");
  expect(asked[0]).toMatch(/^Apply this to db on x\?/);
  expect(result.exitCode).toBe(1);
  expect(scripts).toEqual([]);

  const yes = scripted([true]);
  expect((await runRepair(root, ["--db-url", "postgres://x"], run, yes.prompter)).exitCode).toBe(0);
  const skipped = scripted([]);
  await runRepair(root, ["--db-url", "postgres://x", "--yes"], run, skipped.prompter);
  expect(skipped.asked).toEqual([]);
});

test("repair needs a database URL", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  expect((await runRepair(root, [])).exitCode).toBe(1);
  if (saved !== undefined) process.env.DATABASE_URL = saved;
});

const OLD_CHECK = "CHECK ((role_key ~ '^event:[a-z]+$'::text))";
const FKEY = "FOREIGN KEY (role_key) REFERENCES roles(key) ON DELETE CASCADE";

const ROLE_KEYS: ConstraintSnapshot = {
  compared: new Set(["public.events", "public.roles", "public.role_permissions"]),
  wanted: [
    {
      table: "public.role_permissions",
      name: "role_permissions_role_key_fkey",
      type: "f",
      definition: FKEY,
    },
    { table: "public.events", name: "events_name_key", type: "u", definition: "UNIQUE (name)" },
  ],
  live: [
    {
      table: "public.role_permissions",
      name: "role_permissions_role_key_check",
      type: "c",
      definition: OLD_CHECK,
    },
    { table: "public.events", name: "events_name_key", type: "u", definition: "UNIQUE (name)" },
  ],
};

test("a core table is built in the scratch schema with its core references pointed there", () => {
  expect(
    scratchTable(
      "create table public.grants (role_key text references public.roles (key), user_id uuid references auth.users, team uuid references teams)",
    ),
  ).toBe(
    "create table bogey_repair_scratch.grants (role_key text references bogey_repair_scratch.roles (key), user_id uuid references auth.users, team uuid references bogey_repair_scratch.teams)",
  );
  expect(
    scratchTable("alter table public.tracks add foreign key (form_id) references public.forms"),
  ).toBe(
    "alter table bogey_repair_scratch.tracks add foreign key (form_id) references bogey_repair_scratch.forms",
  );
  expect(scratchTable("alter table public.tracks enable row level security")).toBeNull();
  expect(scratchTable("create table private.x (a int)")).toBeNull();
  expect(scratchTable("create index i on public.x (a)")).toBeNull();
});

test("stale constraints drop before the seed rows and new ones are added after, unvalidated first", () => {
  const plan = planRepair(
    splitStatements(SCHEMA),
    { ...live(), tables: new Set([...OLD.tables, "public.role_permissions"]) },
    ROLE_KEYS,
  );
  expect(plan.missing).toEqual(
    expect.arrayContaining([
      "constraint public.role_permissions.role_permissions_role_key_check (not in supabase/schemas, dropped)",
      "constraint public.role_permissions.role_permissions_role_key_fkey",
    ]),
  );
  expect(plan.missing.join("\n")).not.toContain("events_name_key");
  const drop = plan.statements.findIndex((sql) =>
    sql.includes('drop constraint if exists "role_permissions_role_key_check"'),
  );
  const seed = plan.statements.findIndex((sql) =>
    sql.startsWith("insert into public.role_permissions"),
  );
  const add = plan.statements.findIndex((sql) => sql.includes(`${FKEY} not valid$`));
  expect(drop).toBe(0);
  expect(drop < seed && seed < add).toBe(true);
  expect(plan.statements[add]).toMatch(
    /validate constraint "role_permissions_role_key_fkey".*raise warning/,
  );
  // A column added in the same repair may have created it already (an inline check).
  expect(plan.statements[add]).toContain("exception when duplicate_object then return;");
});

test("a changed constraint is dropped and added again; a table that's being created is left to its statement", () => {
  const changed: ConstraintSnapshot = {
    ...ROLE_KEYS,
    live: [{ ...ROLE_KEYS.wanted[1]!, definition: "UNIQUE (name, kind)" }],
  };
  const plan = planRepair(splitStatements(SCHEMA), live(), changed);
  expect(plan.missing).toEqual(
    expect.arrayContaining(["constraint public.events.events_name_key (changed)"]),
  );
  expect(plan.statements).toContain(
    'alter table public."events" drop constraint if exists "events_name_key"',
  );
  expect(plan.statements.join("\n")).toContain(
    'alter table public."events" add constraint "events_name_key" UNIQUE (name)$',
  );
  expect(plan.statements.join("\n")).not.toContain("role_permissions_role_key_fkey");
});

test("rows that break a new constraint come back as a heads-up, not a failure", async () => {
  const { run } = fakePsql(
    { ...OLD, tables: [...OLD.tables, "public.role_permissions"] },
    undefined,
    {
      compared: [...ROLE_KEYS.compared],
      wanted: ROLE_KEYS.wanted.map((c) => [c.table, c.name, c.type, c.definition]),
      live: ROLE_KEYS.live.map((c) => [c.table, c.name, c.type, c.definition]),
    },
    "psql:<stdin>:40: WARNING:  role_permissions_role_key_fkey on public.role_permissions holds for new rows only",
  );
  const result = await runRepair(root, ["--db-url", "postgres://x"], run);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(
    "! role_permissions_role_key_fkey on public.role_permissions holds for new rows only",
  );
});

test("a failed constraint read leaves constraints alone and says so", async () => {
  const { run } = fakePsql(OLD, undefined, { nope: true });
  const result = await runRepair(root, ["--db-url", "postgres://x", "--dry-run"], run);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Couldn't compare constraints");
});

test("with constraints compared, an alter table adding one to an existing table isn't rerun", () => {
  const statements = [...splitStatements(SCHEMA), "alter table public.events add check (true)"];
  const reconciled = planRepair(statements, live(), ROLE_KEYS);
  expect(reconciled.statements).not.toContain("alter table public.events add check (true)");
  expect(planRepair(statements, live()).statements).toContain(
    "alter table public.events add check (true)",
  );
});
