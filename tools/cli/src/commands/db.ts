import { unknownSubcommand } from "../lib/suggest.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import { databaseUrl, NO_DATABASE_URL } from "../lib/credentials.ts";
import { BASELINE_NAME, buildBaseline } from "../lib/schema.ts";
import {
  applyMigration,
  appliedVersions,
  markApplied,
  migrationFiles,
  migrationName,
  migrationVersion,
  migrationsDir,
  pending,
  releasedPath,
  releasedVersion,
  spawnRunner,
  type Runner,
} from "../lib/migrations.ts";
import { step } from "../lib/activity.ts";
import { describeDrift, schemaDrift } from "../lib/repair.ts";
import { parseFlags } from "../lib/flags.ts";
import { settingDefaultsStale, writeSettingDefaults } from "../lib/setting-defaults.ts";
import { notificationKindsStale, writeNotificationKinds } from "../lib/notification-kinds.ts";
import { migrateBundledPlugins } from "./plugins.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey db <subcommand>

  bogey db url                 Print this instance's local Supabase URLs (API, Studio, DB, mail)
  bogey db studio              Open Supabase Studio in a browser
  bogey db baseline [--check]  Build supabase/migrations/${BASELINE_NAME} from
                               supabase/schemas, after regenerating the setting
                               defaults and notification kinds (--check: fail if either is stale).
                               Refused once a release has shipped it.
  bogey db freeze <version>    Mark the baseline as shipped in <version>; from then on
                               schema changes are new migrations
  bogey db migration <name>    Add supabase/migrations/<timestamp>_<name>.sql, from
                               \`supabase db diff\` when a local stack is running
  bogey db status  [--db-url]  Which migrations a database has applied
  bogey db migrate [--db-url]  Apply the pending ones, oldest first, each in a transaction, then
                               those of the plugins that ship with Bogey (challenges)
  bogey db repair  [--db-url]  Bring an older database in line with supabase/schemas (below)
  bogey db mark-applied [--db-url] <version>|--all
                               Record migrations as applied without running them, for a
                               database set up manually

--db-url defaults to DATABASE_URL (from the environment or .env). status, migrate and mark-applied need psql
and use the table the Supabase CLI keeps, so \`supabase db push\` agrees.

Reads ports from supabase/config.toml, so these only resolve for a local
\`supabase start\` stack. A self-hosted deployment or Supabase Cloud has its
own Studio elsewhere (see docs/self-hosting.md).`;

interface LocalPorts {
  api: number;
  db: number;
  studio: number;
  smtp: number;
}

const DEFAULTS: LocalPorts = { api: 54321, db: 54322, studio: 54323, smtp: 54324 };

function readPort(toml: string, section: string, fallback: number): number {
  const sectionMatch = new RegExp(`\\[${section}\\]([\\s\\S]*?)(\\n\\[|$)`).exec(toml);
  if (!sectionMatch) return fallback;

  const portMatch = /^\s*port\s*=\s*(\d+)/m.exec(sectionMatch[1]);
  return portMatch ? Number(portMatch[1]) : fallback;
}

function readPorts(root: string): LocalPorts {
  const path = join(root, "supabase", "config.toml");
  if (!existsSync(path)) return DEFAULTS;

  const toml = readFileSync(path, "utf-8");
  return {
    api: readPort(toml, "api", DEFAULTS.api),
    db: readPort(toml, "db", DEFAULTS.db),
    studio: readPort(toml, "studio", DEFAULTS.studio),
    smtp: readPort(toml, "local_smtp", DEFAULTS.smtp),
  };
}

function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true }).unref();
}

function dbUrl(cwd: string, args: string[]): string | null {
  return databaseUrl(cwd, parseFlags(args)["db-url"]);
}

const NO_URL = { exitCode: 1, output: NO_DATABASE_URL };

const RELEASE_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function driftLine(root: string, url: string, run: Runner): string | null {
  const drift = step("Compare the database with supabase/schemas", () =>
    schemaDrift(root, url, run),
  );
  return drift.ok && drift.missing.length ? describeDrift(drift.missing) : null;
}

export function runDb(
  cwd: string,
  args: string[],
  opener: (url: string) => void = openInBrowser,
  run: Runner = spawnRunner,
  now: () => Date = () => new Date(),
): CliResult {
  const [subcommand] = args;
  const root = findRepoRoot(cwd);
  const ports = readPorts(root);
  const host = "127.0.0.1";

  switch (subcommand) {
    case "url":
      return {
        exitCode: 0,
        output: [
          `API        http://${host}:${ports.api}`,
          `Studio     http://${host}:${ports.studio}`,
          `Postgres   postgresql://postgres:postgres@${host}:${ports.db}/postgres`,
          `Mail       http://${host}:${ports.smtp}`,
        ].join("\n"),
      };

    case "studio": {
      const url = `http://${host}:${ports.studio}`;
      opener(url);
      return { exitCode: 0, output: `Opening Supabase Studio: ${url}` };
    }

    case "baseline": {
      const path = join(root, "supabase", "migrations", BASELINE_NAME);

      if (args.includes("--check")) {
        const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
        return !settingDefaultsStale(root) &&
          !notificationKindsStale(root) &&
          current === buildBaseline(root)
          ? { exitCode: 0, output: "Baseline migration is up to date." }
          : { exitCode: 1, output: "Baseline migration is stale: run `bogey db baseline`." };
      }

      const released = releasedVersion(root);
      if (released) {
        return {
          exitCode: 1,
          output: `The baseline shipped in ${released}, so it can't change. Add a migration: bogey db migration <name>.`,
        };
      }

      writeSettingDefaults(root);
      writeNotificationKinds(root);
      const built = buildBaseline(root);

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, built);
      return { exitCode: 0, output: `Wrote supabase/migrations/${BASELINE_NAME}.` };
    }

    case "freeze": {
      const version = args[1];
      if (!version) return { exitCode: 1, output: "bogey db freeze <version>, e.g. v1.0.0" };
      if (!RELEASE_TAG.test(version)) {
        return {
          exitCode: 1,
          output: `"${version}" isn't a release version. bogey db freeze <version>, e.g. v1.0.0`,
        };
      }
      const released = releasedVersion(root);
      if (released) return { exitCode: 1, output: `Already frozen at ${released}.` };
      writeFileSync(releasedPath(root), `${version}\n`);
      return {
        exitCode: 0,
        output: `Froze the baseline at ${version}. Schema changes are new migrations from now on.`,
      };
    }

    case "migration": {
      const name = migrationName(
        args
          .slice(1)
          .filter((arg) => !arg.startsWith("--"))
          .join(" "),
      );
      if (!name) return { exitCode: 1, output: "bogey db migration <name>" };
      if (!releasedVersion(root)) {
        return {
          exitCode: 1,
          output:
            "No release has shipped the baseline yet: edit supabase/schemas and run `bogey db baseline`.",
        };
      }
      const diff = run("supabase", [
        "db",
        "diff",
        "--local",
        "--schema",
        "public,private",
        "-f",
        name,
      ]);
      if (diff.status === 0) {
        return {
          exitCode: 0,
          output: `supabase db diff wrote the migration.\n${diff.stdout}`.trim(),
        };
      }
      const file = `${migrationVersion(now())}_${name}.sql`;
      writeFileSync(
        join(migrationsDir(root), file),
        `-- ${name}\n-- Written manually because \`supabase db diff\` couldn't run. Make the same change in\n-- supabase/schemas, so the schema files stay the source of truth.\n`,
      );
      return { exitCode: 0, output: `Wrote supabase/migrations/${file}; fill it in.` };
    }

    case "status": {
      const url = dbUrl(cwd, args);
      if (!url) return NO_URL;
      const applied = appliedVersions(url, run);
      if (!applied.ok) return { exitCode: 1, output: applied.error };
      const lines = migrationFiles(root).map(
        (file) =>
          `  ${applied.versions.has(file.version) ? "✓ applied" : "○ pending"}  ${file.version}_${file.name}`,
      );
      const left = pending(migrationFiles(root), applied.versions).length;
      if (left) {
        return {
          exitCode: 0,
          output: [...lines, "", `${left} pending: bogey db migrate`].join("\n"),
        };
      }
      const drift = driftLine(root, url, run);
      return {
        exitCode: 0,
        output: [...lines, "", drift ? `✗ ${drift}` : "✓ Up to date."].join("\n"),
      };
    }

    case "migrate": {
      const url = dbUrl(cwd, args);
      if (!url) return NO_URL;
      const applied = appliedVersions(url, run);
      if (!applied.ok) return { exitCode: 1, output: applied.error };
      const todo = pending(migrationFiles(root), applied.versions);
      if (todo.length === 0) {
        const drift = driftLine(root, url, run);
        if (drift) {
          return { exitCode: 1, output: `Every migration is recorded as applied, but:\n${drift}` };
        }
      }
      if (args.includes("--dry-run")) {
        const bundled = migrateBundledPlugins(cwd, url, run, true);
        if (!bundled.ok) return { exitCode: 1, output: bundled.error };
        const lines = [
          ...todo.map((file) => `would apply ${file.version}_${file.name}`),
          ...bundled.lines,
        ];
        return { exitCode: 0, output: lines.join("\n") || "✓ Nothing to apply." };
      }
      const done: string[] = [];
      for (const migration of todo) {
        const result = step(`Apply ${migration.version}_${migration.name}`, () =>
          applyMigration(url, migration, run),
        );
        if (result.status !== 0) {
          return {
            exitCode: 1,
            output: [
              `Migration ${migration.version}_${migration.name} failed and was rolled back${done.length ? "; the ones before it stay applied" : ""}.`,
              ...done,
              `✗ failed ${migration.version}_${migration.name}:`,
              result.stderr.trim(),
            ].join("\n"),
          };
        }
        done.push(`✓ applied ${migration.version}_${migration.name}`);
      }
      const bundled = migrateBundledPlugins(cwd, url, run);
      done.push(...bundled.lines);
      if (!bundled.ok) return { exitCode: 1, output: [...done, bundled.error].join("\n") };
      return {
        exitCode: 0,
        output: done.length > 0 ? done.join("\n") : "✓ Nothing to apply. Database is up to date!",
      };
    }

    case "mark-applied": {
      const url = dbUrl(cwd, args);
      if (!url) return NO_URL;
      const files = migrationFiles(root);
      const flags = parseFlags(args);
      const named = args
        .slice(1)
        .filter((arg, index, rest) => !arg.startsWith("--") && rest[index - 1] !== "--db-url");
      const unknown = named.filter((version) => !files.some((file) => file.version === version));
      if (unknown.length) {
        return {
          exitCode: 1,
          output: `No migration ${unknown.join(", ")} in supabase/migrations. bogey db status lists them.`,
        };
      }
      const wanted = flags.all ? files : files.filter((file) => named.includes(file.version));
      if (wanted.length === 0) {
        return { exitCode: 1, output: "Name a migration version, or pass --all." };
      }
      const result = markApplied(url, wanted, run);
      if (result.status !== 0) return { exitCode: 1, output: result.stderr.trim() };
      return { exitCode: 0, output: `Recorded ${wanted.length} as applied.` };
    }

    case undefined:
      return { exitCode: 0, output: USAGE };

    default:
      return {
        exitCode: 1,
        output: unknownSubcommand("db", subcommand, [
          "baseline",
          "freeze",
          "migration",
          "status",
          "migrate",
          "mark-applied",
          "repair",
          "url",
          "studio",
        ]),
      };
  }
}
