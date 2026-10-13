import { findRepoRoot } from "../lib/repo-root.ts";
import { databaseUrl, NO_DATABASE_URL } from "../lib/credentials.ts";
import { BASELINE_NAME, schemaFiles } from "../lib/schema.ts";
import {
  migrationFiles,
  releasedVersion,
  retryingLockConflicts,
  spawnRunner,
  type Runner,
} from "../lib/migrations.ts";
import {
  buildScript,
  describeFailure,
  planRepair,
  readConstraints,
  readLiveSchema,
  schemaStatements,
} from "../lib/repair.ts";
import { step } from "../lib/activity.ts";
import { bold, good, warn } from "../lib/style.ts";
import type { Prompter } from "../lib/prompt.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey db repair [--db-url <postgres url>] [--dry-run] [--yes]

Brings a database's core schema in line with supabase/schemas, for one set up
by an older Bogey or changed manually. It reads what the database has, then:

  - creates missing tables and enum types, and adds missing columns and enum values
  - brings existing tables' check, foreign key and unique constraints in line: ones the
    schema dropped or changed are dropped before the seed rows, new ones added after. A
    check or foreign key that existing rows break holds for new rows only, with a warning
  - re-applies every function, view, trigger, policy, index, grant and cron job,
    so each matches the schema files
  - re-runs the schema's seed rows, skipping ones that already exist

It never drops a table, column or row; columns the schema doesn't know about are
listed and left alone. Everything after the enum values runs in one transaction,
so a failure changes nothing. Before the first release it also records the
baseline as applied.

--db-url defaults to DATABASE_URL (from the environment or .env); needs psql. --dry-run says what's missing
without changing anything. At a terminal it shows the plan and asks before changing anything;
--yes skips the question. Plugins' tables are theirs: bogey plugins migrate.`;

export async function runRepair(
  cwd: string,
  args: string[],
  run: Runner = spawnRunner,
  prompter: Prompter | null = null,
): Promise<CliResult> {
  const root = findRepoRoot(cwd);
  const flags = parseFlags(args);
  const dbUrl = databaseUrl(root, flags["db-url"]);
  if (!dbUrl) return { exitCode: 1, output: NO_DATABASE_URL };

  const files = schemaFiles(root);
  if (files.length === 0)
    return { exitCode: 1, output: "bogey db repair: supabase/schemas is empty." };

  const live = step(`Read the schema of ${where(dbUrl)}`, () => readLiveSchema(dbUrl, run));
  if (!live.ok) return { exitCode: 1, output: live.error };

  const statements = schemaStatements(root);
  const constraints = step("Compare constraints", () => readConstraints(dbUrl, run, statements));
  const plan = planRepair(
    statements,
    live.schema,
    constraints.ok ? constraints.snapshot : undefined,
  );
  if (!constraints.ok) {
    plan.warnings.push(
      `Couldn't compare constraints, so they're left as they are: ${constraints.error}`,
    );
  }

  const baseline = releasedVersion(root)
    ? null
    : migrationFiles(root).find((file) => `${file.version}_${file.name}.sql` === BASELINE_NAME);
  if (baseline) {
    plan.statements.push(
      "create schema if not exists supabase_migrations",
      "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)",
      `insert into supabase_migrations.schema_migrations (version, name) values ('${baseline.version}', '${baseline.name}') on conflict do nothing`,
    );
  }

  const report = [
    plan.missing.length
      ? `To add or change:\n${plan.missing.map((item) => `  + ${item}`).join("\n")}`
      : "No tables, columns, enum values or constraints to add or change.",
    ...(plan.warnings.length
      ? [`Heads up:\n${plan.warnings.map((warning) => `  ! ${warning}`).join("\n")}\n`]
      : []),
  ];

  if (flags["dry-run"]) {
    return {
      exitCode: 0,
      output: [
        ...report,
        `Would add what's missing and re-apply ${plan.rerun} statements from supabase/schemas.`,
      ].join("\n\n"),
    };
  }

  let lead = report;
  if (prompter && !flags.yes) {
    prompter.say(styled(report.join("\n\n")));
    lead = [];
    const go = await prompter.confirm({
      message: `Apply this to ${where(dbUrl)}? It adds missing items and re-applies ${plan.rerun} statements. No tables, columns or rows will be removed.`,
    });
    if (!go) return { exitCode: 1, output: "Cancelled. Nothing was changed." };
    prompter.say("");
  }

  if (plan.enumLabels.length) {
    const script = buildScript(plan.enumLabels, false);
    const result = step(`Add ${plan.enumLabels.length} enum value(s)`, () =>
      retryingLockConflicts(() => run("psql", [dbUrl, "-q", "-f", "-"], script.text)),
    );
    if (result.status !== 0) {
      return {
        exitCode: 1,
        output: [
          ...lead,
          `Adding enum values failed, so nothing else was changed:\n${describeFailure(script, result)}`,
        ].join("\n\n"),
      };
    }
  }

  const script = buildScript(plan.statements, true);
  const result = step(
    `Applying ${plan.statements.length} statements (this may take a while)...`,
    () => retryingLockConflicts(() => run("psql", [dbUrl, "-q", "-f", "-"], script.text)),
  );
  if (result.status !== 0) {
    return {
      exitCode: 1,
      output: [
        ...lead,
        `Repair failed and was rolled back, so nothing else changed${plan.enumLabels.length ? " (the enum values stay added; that's harmless)" : ""}. The error:\n${describeFailure(script, result)}`,
      ].join("\n\n"),
    };
  }

  const warnings = result.stderr
    .split("\n")
    .map((line) => /^psql:<stdin>:\d+: WARNING:\s*(.*)$/.exec(line)?.[1])
    .filter((line): line is string => Boolean(line));

  return {
    exitCode: 0,
    output: [
      ...lead,
      ...(warnings.length
        ? [`Heads up:\n${warnings.map((warning) => `  ! ${warning}`).join("\n")}`]
        : []),
      `Repaired: re-applied ${plan.rerun} statements from supabase/schemas.`,
      "Run bogey db status to check its migrations, and bogey plugins migrate to handle plugins.",
    ].join("\n\n"),
  };
}

function where(dbUrl: string): string {
  try {
    const url = new URL(dbUrl);
    return `${url.pathname.slice(1) || "postgres"} on ${url.host}`;
  } catch {
    return "the database";
  }
}

function styled(text: string): string {
  return text
    .replace(/^(\w[\w ]*:)$/gm, (heading) => bold(heading))
    .replace(/^ {2}\+ /gm, `  ${good("+")} `)
    .replace(/^ {2}! /gm, `  ${warn("!")} `);
}
