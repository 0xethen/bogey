import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vite-plus/test";
import { runDoctor } from "../../src/commands/doctor.ts";
import { installedPlugins } from "../../src/commands/plugins.ts";
import { migrationFiles, pluginMigrationFiles, type Runner } from "../../src/lib/migrations.ts";
import { parseEnum, parseTable, schemaStatements } from "../../src/lib/repair.ts";
import { findRepoRoot } from "../../src/lib/repo-root.ts";
import { pluginDir } from "../../src/lib/plugin-dirs.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

function upToDate(root: string): Runner {
  const versions = migrationFiles(root).map((migration) => migration.version);
  const plugins = installedPlugins(root).flatMap((key) =>
    pluginMigrationFiles(pluginDir(root, key), key).map(
      (migration) => `${migration.plugin}:${migration.version}|`,
    ),
  );
  const catalog = { tables: [] as string[], columns: [] as string[], enums: [] as string[][] };
  for (const statement of schemaStatements(root)) {
    const table = parseTable(statement);
    if (table) {
      catalog.tables.push(table.name);
      for (const column of table.columns.keys()) catalog.columns.push(`${table.name}.${column}`);
    }
    const type = parseEnum(statement);
    if (type) for (const label of type.labels) catalog.enums.push([type.name, label]);
  }
  return (_command, args) => {
    const query = args[args.indexOf("-c") + 1] ?? "";
    const stdout = query.includes("plugin_migrations")
      ? plugins.join("\n")
      : query.includes("schema_migrations")
        ? versions.join("\n")
        : JSON.stringify(catalog);
    return { status: 0, stdout, stderr: "" };
  };
}

test("runDoctor passes against this repo's actual config", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://postgres.test:pw@localhost:5432/postgres");
  try {
    const result = runDoctor(cliDir, upToDate(findRepoRoot(cliDir)));
    expect(result.output).toContain("no issues found");
    expect(result.exitCode).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("runDoctor fails outside a repo checkout", () => {
  expect(() => runDoctor("/")).toThrow();
});

test("runDoctor reports a bogey.config that the server couldn't start with", () => {
  const dir = mkdtempSync(join(tmpdir(), "bogey-doctor-"));
  const file = join(dir, "bogey.config.json");
  writeFileSync(file, JSON.stringify({ brand: { name: "" }, upstream: "nope" }));
  vi.stubEnv("BOGEY_CONFIG", file);
  try {
    const result = runDoctor(cliDir);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/isn't valid/);
    expect(result.output).toMatch(/brand\.name/);
    expect(result.output).toMatch(/upstream/);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("runDoctor says a database that recorded every migration still lacks the schema's tables", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://postgres.test:pw@localhost:5432/postgres");
  try {
    const root = findRepoRoot(cliDir);
    const real = upToDate(root);
    const behind: Runner = (command, args, input) => {
      const result = real(command, args, input);
      const query = args[args.indexOf("-c") + 1] ?? "";
      if (!query.includes("json_build_object")) return result;
      const catalog = JSON.parse(result.stdout) as { tables: string[] };
      catalog.tables = catalog.tables.filter((table) => table !== "public.events");
      return { ...result, stdout: JSON.stringify(catalog) };
    };
    const result = runDoctor(cliDir, behind);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(
      /differs from supabase\/schemas in 1 thing\(s\).*table public\.events.*bogey db repair/,
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
