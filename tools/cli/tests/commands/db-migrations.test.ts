import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { runDb } from "../../src/commands/db.ts";
import {
  retryingLockConflicts,
  spawnRunner,
  type ProcessResult,
  type Runner,
} from "../../src/lib/migrations.ts";

let root: string;
const migrations = () => join(root, "supabase", "migrations");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-db-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(root, "supabase", "schemas"), { recursive: true });
  mkdirSync(migrations(), { recursive: true });
  writeFileSync(join(migrations(), "20260924000000_baseline.sql"), "select 1;");
  writeFileSync(join(migrations(), "20261101000000_add_things.sql"), "select 2;");
});

function fakePsql(applied: string[]) {
  const scripts: string[] = [];
  const run: Runner = (command, args, input): ProcessResult => {
    if (command !== "psql") return { status: 1, stdout: "", stderr: `${command}: not found` };
    if (args.includes("-c")) return { status: 0, stdout: applied.join("\n"), stderr: "" };
    scripts.push(input ?? "");
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, scripts };
}

const at = () => new Date("2026-12-01T10:20:30Z");

test("status lists applied and pending migrations", () => {
  const { run } = fakePsql(["20260924000000"]);
  const result = runDb(root, ["status", "--db-url", "postgres://x"], () => {}, run);
  expect(result.output).toMatch(/applied\s+20260924000000_baseline/);
  expect(result.output).toMatch(/pending\s+20261101000000_add_things/);
  expect(result.output).toContain("1 pending");
});

test("migrate applies only what's pending, each recorded in the same transaction", () => {
  const { run, scripts } = fakePsql(["20260924000000"]);
  const result = runDb(root, ["migrate", "--db-url", "postgres://x"], () => {}, run);
  expect(result.exitCode).toBe(0);
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toContain("20261101000000_add_things.sql");
  expect(scripts[0]).toMatch(/begin;[\s\S]*insert into supabase_migrations[\s\S]*commit;/);
});

test("migrate needs a database URL", () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  expect(runDb(root, ["migrate"]).exitCode).toBe(1);
  if (saved !== undefined) process.env.DATABASE_URL = saved;
});

test("before a release, migrations go into the baseline", () => {
  const result = runDb(root, ["migration", "add stuff"], () => {}, fakePsql([]).run, at);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("bogey db baseline");
});

test("freezing stops baseline rebuilds and starts append-only migrations", () => {
  expect(runDb(root, ["freeze", "v1.0.0"]).exitCode).toBe(0);
  const baseline = runDb(root, ["baseline"]);
  expect(baseline.output).toContain("shipped in v1.0.0");
  expect(baseline.output).toContain("docs/contributing.md#changing-the-schema");
  expect(readFileSync(join(migrations(), "20260924000000_baseline.sql"), "utf-8")).toBe(
    "select 1;",
  );

  const result = runDb(root, ["migration", "Add Judges!"], () => {}, fakePsql([]).run, at);
  expect(result.exitCode).toBe(0);
  expect(readdirSync(migrations())).toContain("20261201102030_add_judges.sql");
});

test("a missing program says what to install, not ENOENT", () => {
  const result = spawnRunner("bogey-no-such-program", []);
  expect(result.status).toBeNull();
  expect(result.stderr).toBe("bogey-no-such-program isn't installed (or isn't on your PATH).");
});

test("a program that stops before reading all its input reports its own error, not EPIPE", () => {
  const result = spawnRunner(
    "sh",
    ["-c", "echo 'ERROR:  boom' >&2; exit 3"],
    "x".repeat(5_000_000),
  );
  expect(result.status).toBe(3);
  expect(result.stderr).toContain("ERROR:  boom");
});

function behindPsql(): Runner {
  return (_command, args) => {
    const query = args[args.indexOf("-c") + 1] ?? "";
    if (query.includes("json_build_object")) {
      return {
        status: 0,
        stdout: JSON.stringify({ tables: [], columns: [], enums: [] }),
        stderr: "",
      };
    }
    return { status: 0, stdout: "20260924000000\n20261101000000", stderr: "" };
  };
}

test("status and migrate catch a schema the recorded versions don't show", () => {
  writeFileSync(
    join(root, "supabase", "schemas", "00_things.sql"),
    "create table public.things (id uuid primary key);",
  );
  const status = runDb(root, ["status", "--db-url", "postgres://x"], () => {}, behindPsql());
  expect(status.output).toMatch(
    /✗ The database differs from supabase\/schemas in 1 thing\(s\).*table public\.things/,
  );

  const migrate = runDb(root, ["migrate", "--db-url", "postgres://x"], () => {}, behindPsql());
  expect(migrate.exitCode).toBe(1);
  expect(migrate.output).toContain("bogey db repair");
});

test("a wrong user isn't mistaken for a database with no migrations", () => {
  const run: Runner = () => ({
    status: 2,
    stdout: "",
    stderr: 'psql: error: FATAL:  role "postgres.typo" does not exist',
  });
  const result = runDb(root, ["status", "--db-url", "postgres://x"], () => {}, run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain('role "postgres.typo" does not exist');
});

test("freeze takes a release version, and mark-applied only versions that exist", () => {
  expect(runDb(root, ["freeze", "1.0"]).exitCode).toBe(1);
  const { run, scripts } = fakePsql([]);
  const result = runDb(
    root,
    ["mark-applied", "--db-url", "postgres://x", "20990101000000"],
    () => {},
    run,
  );
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("No migration 20990101000000");
  expect(scripts).toHaveLength(0);
});

test("a bare --db-url doesn't fall back to another database", () => {
  vi.stubEnv("DATABASE_URL", "postgres://somewhere-else");
  try {
    const { run } = fakePsql([]);
    expect(runDb(root, ["status", "--db-url"], () => {}, run).exitCode).toBe(1);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("a transaction that lost a lock race runs again, and other failures don't", () => {
  const deadlock = { status: 3, stdout: "", stderr: "ERROR:  deadlock detected" };
  const ok = { status: 0, stdout: "", stderr: "" };
  const pauses: number[] = [];
  let calls = 0;
  const result = retryingLockConflicts(
    () => (++calls < 3 ? deadlock : ok),
    4,
    (ms) => pauses.push(ms),
  );
  expect(result.status).toBe(0);
  expect(pauses).toEqual([1000, 2000]);

  calls = 0;
  const syntax = { status: 3, stdout: "", stderr: "ERROR:  syntax error at end of input" };
  expect(
    retryingLockConflicts(
      () => (calls++, syntax),
      4,
      () => {},
    ),
  ).toBe(syntax);
  expect(calls).toBe(1);

  calls = 0;
  expect(
    retryingLockConflicts(
      () => (calls++, deadlock),
      4,
      () => {},
    ).status,
  ).toBe(3);
  expect(calls).toBe(4);
});
