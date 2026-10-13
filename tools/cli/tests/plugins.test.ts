import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import { runDb } from "../src/commands/db.ts";
import { runPlugins } from "../src/commands/plugins.ts";
import type { ProcessResult, Runner } from "../src/lib/migrations.ts";

let root: string;

const CONFIG = `export default defineConfig({
  brand: { name: "Test" },
  plugins: {
    // A comment that must survive every edit.
    disabled: [],
  },
});
`;

const disabledFile = () => readFileSync(join(root, "bogey.config.ts"), "utf-8");
const installed = (...parts: string[]) => join(root, "packages", "plugins", "installed", ...parts);

function addPlugin(key: string, extra = "", api = 1, fields = ""): void {
  mkdirSync(installed(key), { recursive: true });
  writeFileSync(
    installed(key, "manifest.ts"),
    [
      "export const manifest = definePlugin({",
      `  key: "${key}",`,
      `  name: "${key.toUpperCase()}",`,
      `  api: ${api},`,
      '  version: "1.2.3",',
      '  description: "A test plugin.",',
      '  author: { name: "Tester" },',
      '  license: "MIT",',
      `  source: { repository: "github:someone/${key}" },`,
      ...(fields ? [fields] : []),
      "});",
      "",
    ].join("\n"),
  );
  if (extra) writeFileSync(installed(key, "schema.sql"), extra);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogeyx-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(root, "bogey.config.ts"), CONFIG);
  addPlugin("alpha", "create table alpha ();");
  addPlugin("beta");
});

test("list shows every installed plugin with version and source", async () => {
  const result = await runPlugins(root, ["list"]);
  expect(result.exitCode).toBe(0);
  expect(result.output).toMatch(/on\s+alpha\s+1\.2\.3\s+github:someone\/alpha/);
  expect(result.output).toContain("2 of 2 enabled");
});

test("list flags plugins written for a plugin API this Bogey doesn't load", async () => {
  addPlugin("gamma", "", 99);
  const result = await runPlugins(root, ["list"]);
  expect(result.output).toMatch(/!!\s+gamma/);
  expect(result.output).toContain("Bogey skips it");
});

test("list with nothing installed says so", async () => {
  root = mkdtempSync(join(tmpdir(), "bogeyx-empty-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const result = await runPlugins(root, ["list"]);
  expect(result.output).toContain("No plugins installed");
});

test("disable and enable edit only the list and keep comments", async () => {
  expect((await runPlugins(root, ["disable", "beta"])).exitCode).toBe(0);
  expect(disabledFile()).toContain('"beta"');
  expect(disabledFile()).toContain("A comment that must survive");
  expect((await runPlugins(root, ["list"])).output).toMatch(/off\s+beta/);

  expect((await runPlugins(root, ["enable", "beta"])).exitCode).toBe(0);
  expect(disabledFile()).not.toContain('"beta"');
});

test("disable refuses a plugin that isn't installed", async () => {
  expect((await runPlugins(root, ["disable", "nope"])).exitCode).toBe(1);
});

test("info reports the source", async () => {
  const result = await runPlugins(root, ["info", "alpha"]);
  expect(result.output).toContain("github:someone/alpha");
  expect(result.output).toMatch(/migrations\s+1/);
});

test("sql prints enabled plugins' schema files", async () => {
  const result = await runPlugins(root, ["sql"]);
  expect(result.output).toContain("create table alpha");
  await runPlugins(root, ["disable", "alpha"]);
  expect((await runPlugins(root, ["sql"])).output).toBe("-- no plugin SQL");
});

test("new scaffolds a sourced plugin", async () => {
  const result = await runPlugins(root, ["new", "gamma", "--repo=github:me/gamma"]);
  expect(result.exitCode).toBe(0);
  expect(readFileSync(installed("gamma", "manifest.ts"), "utf-8")).toContain(
    'source: { repository: "github:me/gamma" }',
  );
  expect(existsSync(installed("gamma", "runtime.tsx"))).toBe(true);
});

test("new requires --repo and a valid key", async () => {
  expect((await runPlugins(root, ["new", "gamma"])).exitCode).toBe(1);
  expect((await runPlugins(root, ["new", "Bad_Key", "--repo=github:me/x"])).exitCode).toBe(1);
  expect((await runPlugins(root, ["new", "alpha", "--repo=github:me/x"])).exitCode).toBe(1);
});

function fakePsql(applied: string[], answer: (script: string) => string = () => "") {
  const scripts: string[] = [];
  const run: Runner = (command, args, input): ProcessResult => {
    if (command !== "psql") return { status: 1, stdout: "", stderr: `${command}: not found` };
    if (args.includes("-c")) return { status: 0, stdout: applied.join("\n"), stderr: "" };
    scripts.push(input ?? "");
    return { status: 0, stdout: answer(input ?? ""), stderr: "" };
  };
  return { run, scripts };
}

const recorded =
  (...rows: string[]) =>
  (script: string) =>
    script.includes("group by plugin") ? rows.map((row) => row.replace(/ /g, "\t")).join("\n") : "";

function addMigration(key: string, file: string, text: string): void {
  mkdirSync(installed(key, "migrations"), { recursive: true });
  writeFileSync(installed(key, "migrations", file), text);
}

test("migrations run in number order; an old schema.sql counts as migration 0", async () => {
  addMigration("beta", "10_later.sql", "select 10;");
  addMigration("beta", "2_first.sql", "select 2;");
  const { run } = fakePsql([]);
  const result = await runPlugins(root, ["status", "--db-url", "postgres://x"], run);
  expect(result.output.split("\n").slice(0, 3)).toEqual([
    "  ○ pending  alpha  0_schema",
    "  ○ pending  beta  2_first",
    "  ○ pending  beta  10_later",
  ]);
});

test("migrate applies only what's pending, recording each", async () => {
  addMigration("beta", "1_init.sql", "select 1;");
  addMigration("beta", "2_more.sql", "select 2;");
  const { run, scripts } = fakePsql(["alpha:0", "beta:1"], recorded("beta 3 1"));
  const result = await runPlugins(root, ["migrate", "--db-url", "postgres://x"], run);
  expect(result.output).toBe("✓ applied beta 2_more");
  const applied = scripts.filter((script) => script.includes("2_more.sql"));
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatch(/values \('beta', '2', 'more', '[0-9a-f]{64}'\)/);
});

test("a migration runs between begin and end, so the database records what it made", async () => {
  addMigration("beta", "1_init.sql", "create table public.beta_things ();");
  const { run, scripts } = fakePsql([]);
  await runPlugins(root, ["migrate", "beta", "--db-url", "postgres://x"], run);
  const script = scripts.find((each) => each.includes("1_init.sql")) ?? "";
  expect(script).toContain("begin isolation level repeatable read;");
  expect(script.indexOf("plugin_migration_begin('beta')")).toBeLessThan(
    script.indexOf("1_init.sql"),
  );
  expect(script.indexOf("1_init.sql")).toBeLessThan(script.indexOf("plugin_migration_end('beta'"));
});

test("a migration may build on what the plugins it requires share", async () => {
  addPlugin("gamma", "", 1, `  shares: { messages: true, sql: ["gamma_scores", "gamma_rank"] },`);
  addPlugin("delta", "", 1, '  requires: ["gamma"],');
  addMigration("delta", "1_init.sql", "select 1;");
  const { run, scripts } = fakePsql([]);
  await runPlugins(root, ["migrate", "delta", "--db-url", "postgres://x"], run);
  expect(scripts.join("\n")).toContain(
    `plugin_migration_end('delta', array['gamma']::text[], '{"gamma":["gamma_scores","gamma_rank"]}'::jsonb)`,
  );
});

test("a plugin migrated before Bogey kept records has what its migrations named adopted first", async () => {
  addMigration(
    "beta",
    "1_init.sql",
    "create table public.beta_things (id int);\nselect cron.schedule('bogey-beta', '* * * * *', 'select 1');",
  );
  addMigration("beta", "2_more.sql", "select 2;");
  const { run, scripts } = fakePsql(["beta:1"], recorded());
  const result = await runPlugins(root, ["migrate", "beta", "--db-url", "postgres://x"], run);
  const adopt = scripts.find((script) => script.includes("plugin_adopt")) ?? "";
  expect(adopt).toContain('"kind":"relation","schema":"public","name":"beta_things"');
  expect(adopt).toContain('"kind":"cron job","name":"bogey-beta"');
  expect(scripts.indexOf(adopt)).toBeLessThan(scripts.findIndex((s) => s.includes("2_more.sql")));
  expect(result.output).toContain("✓ applied beta 2_more");
});

test("status flags an applied migration whose file changed since", async () => {
  addMigration("beta", "1_init.sql", "select 1;");
  const { run } = fakePsql(["alpha:0", `beta:1|${"0".repeat(64)}`]);
  const result = await runPlugins(root, ["status", "--db-url", "postgres://x"], run);
  expect(result.output).toContain("! changed  beta  1_init");
  expect(result.output).toContain("Put the change in a new migration");
});

test("migrations of a plugin that isn't installed are an error, not nothing to do", async () => {
  const { run } = fakePsql([]);
  const result = await runPlugins(root, ["migrate", "nope", "--db-url", "postgres://x"], run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(`"nope" isn't installed`);
});

test("migrate can be limited to named plugins and needs a database", async () => {
  addMigration("beta", "1_init.sql", "select 1;");
  const { run, scripts } = fakePsql([]);
  await runPlugins(root, ["migrate", "beta", "--db-url", "postgres://x"], run);
  expect(scripts.map((script) => script.includes("beta"))).toEqual([true]);
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  expect((await runPlugins(root, ["migrate"], run)).exitCode).toBe(1);
  if (saved !== undefined) process.env.DATABASE_URL = saved;
});

function addBundled(key: string, sql: string): void {
  const dir = join(root, "packages", "plugins", "bundled", key);
  mkdirSync(join(dir, "migrations"), { recursive: true });
  writeFileSync(
    join(dir, "manifest.ts"),
    `export const manifest = definePlugin({\n  key: "${key}",\n  name: "Shipped",\n  api: 1,\n  version: "1.0.0",\n});\n`,
  );
  writeFileSync(join(dir, "migrations", "0_schema.sql"), sql);
}

test("bundled plugins list beside installed ones and say they ship with Bogey", async () => {
  addBundled("shipped", "select 'shipped';");
  const result = await runPlugins(root, ["list"]);
  expect(result.output).toMatch(/on\s+shipped\s+1\.0\.0\s+ships with Bogey/);
  expect(result.output).toContain("3 of 3 enabled");
  expect((await runPlugins(root, ["info", "shipped"])).output).toContain("ships with Bogey");
});

test("bundled plugins migrate like installed ones, and can't be scaffolded over", async () => {
  addBundled("shipped", "select 'shipped';");
  const { run, scripts } = fakePsql(["alpha:0"]);
  const result = await runPlugins(root, ["migrate", "--db-url", "postgres://x"], run);
  expect(result.output).toContain("✓ applied shipped 0_schema");
  expect(scripts.some((script) => script.includes("shipped"))).toBe(true);
  expect((await runPlugins(root, ["new", "shipped", "--repo=github:me/x"])).exitCode).toBe(1);
});

test("db migrate applies the bundled plugins' migrations after core's", async () => {
  addBundled("shipped", "select 'shipped';");
  mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
  const { run, scripts } = fakePsql([]);
  const result = runDb(root, ["migrate", "--db-url", "postgres://x"], () => {}, run);
  expect(result.output).toContain("✓ applied shipped 0_schema");
  expect(scripts.some((script) => script.includes("alpha"))).toBe(false);
});

function removing(lines: string[], done = "dropped table public.beta_things") {
  return (script: string) =>
    script.includes("group by plugin")
      ? "beta\t1\t1"
      : script.includes("plugin_removal(")
        ? lines.join("\n")
        : script.includes("plugin_remove(")
          ? done
          : "";
}

test("remove drops what the plugin made, then its folder and lock entry", async () => {
  writeFileSync(
    join(root, "bogey.plugins.lock"),
    JSON.stringify({
      beta: { source: "github:someone/x/beta", version: "1.2.3", integrity: "sha256-x" },
    }),
  );
  const { run, scripts } = fakePsql(
    [],
    removing(["object\ttable public.beta_things", "row\t2 settings rows", "migrations\t1"]),
  );
  const said: string[] = [];
  const result = await runPlugins(root, ["remove", "beta", "--db-url", "postgres://x"], run, {
    confirm: async () => true,
    say: (text) => said.push(text),
  });
  expect(said.join("\n")).toContain("table public.beta_things");
  expect(said.join("\n")).toContain("2 settings rows");
  expect(result.exitCode).toBe(0);
  expect(scripts.some((script) => script.includes("private.plugin_remove('beta')"))).toBe(true);
  expect(existsSync(installed("beta"))).toBe(false);
  expect(readFileSync(join(root, "bogey.plugins.lock"), "utf-8")).not.toContain("beta");
});

test("remove changes nothing when it isn't confirmed, or something else builds on the plugin", async () => {
  const declined = fakePsql([], removing(["object\ttable public.beta_things"]));
  const result = await runPlugins(
    root,
    ["remove", "beta", "--db-url", "postgres://x"],
    declined.run,
    {
      confirm: async () => false,
      say: () => {},
    },
  );
  expect(result.exitCode).toBe(1);
  expect(declined.scripts.some((script) => script.includes("plugin_remove("))).toBe(false);
  expect(existsSync(installed("beta"))).toBe(true);

  const blocked = fakePsql(
    [],
    removing([
      "object\ttable public.beta_things",
      "blocker\tgamma_fk on public.gamma_t depends on public.beta_things",
    ]),
  );
  const refused = await runPlugins(
    root,
    ["remove", "beta", "--yes", "--db-url", "postgres://x"],
    blocked.run,
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.output).toContain("can't be removed while something else builds on it");
  expect(blocked.scripts.some((script) => script.includes("plugin_remove("))).toBe(false);
});

test("remove refuses a plugin another installed plugin requires, and one that ships with Bogey", async () => {
  addPlugin("delta", "", 1, '  requires: ["beta"],');
  const { run } = fakePsql([]);
  const result = await runPlugins(
    root,
    ["remove", "beta", "--yes", "--db-url", "postgres://x"],
    run,
  );
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("delta requires beta");

  addBundled("shipped", "select 1;");
  expect((await runPlugins(root, ["remove", "shipped", "--yes"], run)).output).toContain(
    "ships with Bogey",
  );
});

test("remove clears what a deleted plugin left, finding it by name when there's no record", async () => {
  const { run, scripts } = fakePsql([], (script) =>
    script.includes("group by plugin")
      ? "discord\t0\t1"
      : script.includes("plugin_removal(")
        ? "adopted\ttable public.discord_posted\nobject\ttable public.discord_posted\nobject\tcron job bogey-discord\nmigrations\t1"
        : "",
  );
  const result = await runPlugins(
    root,
    ["remove", "discord", "--yes", "--db-url", "postgres://x"],
    run,
    {
      say: () => {},
    },
  );
  expect(result.exitCode).toBe(0);
  const removal = scripts.find((script) => script.includes("plugin_remove('discord')")) ?? "";
  expect(removal).toContain("discord\\_%");
  expect(removal).toContain("'bogey-discord'");
});

test("status lists plugins the database remembers that aren't installed any more", async () => {
  const { run } = fakePsql([], recorded("discord 0 1", "alpha 2 1"));
  const result = await runPlugins(root, ["status", "--db-url", "postgres://x"], run);
  expect(result.output).toContain("In the database but not installed: discord.");
});
