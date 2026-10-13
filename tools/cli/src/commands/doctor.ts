import { busy, step } from "../lib/activity.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkAuthHookWiring,
  checkDatabaseUrl,
  checkEnvFileSafety,
  checkPluginKeys,
  checkSelfHostedHookWiring,
  type ConsistencyIssue,
} from "../lib/checks.ts";
import { loadConfig } from "@bogey/config/load";
import { imageHome } from "../lib/image.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import { databaseUrl, hostOf, readEnv, serviceCredentials } from "../lib/credentials.ts";
import { remoteChecks } from "../lib/remote-checks.ts";
import { lockProblems } from "../lib/plugin-install.ts";
import {
  appliedVersions,
  migrationFiles,
  pending,
  spawnRunner,
  type Runner,
} from "../lib/migrations.ts";
import { describeDrift, schemaDrift } from "../lib/repair.ts";
import { bundledPluginKeys, pluginDir, pluginFolders } from "../lib/plugin-dirs.ts";
import { changedNotice, pluginMigrationState } from "./plugins.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey doctor [--remote]

Checks that this instance is wired up: bogey.config.ts reads and is valid (BOGEY_CONFIG
names another file), the sign-up hook in supabase/config.toml
(and, when GOTRUE_* variables are set, the self-hosted equivalent), .env
safety, that disabled plugins are installed, and, when DATABASE_URL is set (environment or .env),
that the database has applied every migration (needs psql). Exits non-zero on
any issue.

  --remote   Also check the project .env points at, through its API with the service key:
             sign-ups and auto-confirm, that the schema is applied and an organization exists,
             the app address, and whether mail has gone through the Send Email hook. With
             SUPABASE_ACCESS_TOKEN (a Management API token, Supabase Cloud only) it reads the
             dashboard's hook, OTP length and authenticator-app settings too.`;

function localIssues(cwd: string, run: Runner): ConsistencyIssue[] {
  const root = findRepoRoot(cwd);
  const issues: ConsistencyIssue[] = [];

  const configTomlPath = join(root, "supabase", "config.toml");
  if (existsSync(configTomlPath)) {
    issues.push(...checkAuthHookWiring(readFileSync(configTomlPath, "utf-8")));
  } else if (!imageHome()) {
    issues.push({ message: `Missing ${configTomlPath}. Run \`supabase init\` first` });
  }

  const envPath = join(root, ".env");
  if (existsSync(envPath)) issues.push(...checkEnvFileSafety(readFileSync(envPath, "utf-8")));

  issues.push(...checkSelfHostedHookWiring(process.env));

  let disabledPlugins: Tuple<string> = [];
  try {
    disabledPlugins = loadConfig(process.env, root).config.disabledPlugins;
  } catch (error) {
    issues.push({ message: error instanceof Error ? error.message : String(error) });
  }

  issues.push(...checkPluginKeys(disabledPlugins));
  issues.push(...lockProblems(root).map((message) => ({ message })));

  const { installed } = pluginFolders(root);
  const installedKeys = existsSync(installed)
    ? readdirSync(installed, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
        )
        .map((entry) => entry.name)
    : [];
  const keys = [...new Set([...bundledPluginKeys(root), ...installedKeys])];

  for (const key of keys) {
    const manifestPath = join(pluginDir(root, key), "manifest.ts");
    if (!existsSync(manifestPath)) {
      issues.push({ message: `packages/plugins/installed/${key} has no manifest.ts` });
      continue;
    }
    const source = readFileSync(manifestPath, "utf-8");
    if (!/^\s*source:\s*\{[^}]*repository:/ms.test(source)) {
      issues.push({ message: `Plugin "${key}" has no source repository, so it can't be updated` });
    }
    if (!/author:\s*\{[^}]*?name:\s*"[^"]+"/s.test(source)) {
      issues.push({ message: `Plugin "${key}" has no author` });
    }
  }

  for (const key of disabledPlugins) {
    if (!keys.includes(key)) {
      issues.push({ message: `"${key}" is in disabledPlugins but isn't installed` });
    }
  }

  const dbUrl = databaseUrl(root, undefined);
  issues.push(...checkDatabaseUrl(dbUrl));
  if (dbUrl) {
    const applied = appliedVersions(dbUrl, run);
    if (!applied.ok) {
      issues.push({ message: `Couldn't read the database's migrations: ${applied.error}` });
    } else {
      const left = pending(migrationFiles(root), applied.versions);
      const first = left[0];
      if (first) {
        issues.push({
          message: `The database hasn't applied ${left.length} migration(s), starting with ${first.version}_${first.name}: run bogey db migrate`,
        });
      } else {
        const drift = schemaDrift(root, dbUrl, run);
        if (!drift.ok) {
          issues.push({
            message: `Couldn't compare the database with supabase/schemas: ${drift.error}`,
          });
        } else if (drift.missing.length) {
          issues.push({ message: describeDrift(drift.missing) });
        }
      }
    }

    const plugins = pluginMigrationState(cwd, dbUrl, run);
    if (!plugins.ok) {
      issues.push({ message: `Couldn't read the database's plugin migrations: ${plugins.error}` });
    } else {
      const next = plugins.pending[0];
      if (next) {
        issues.push({
          message: `The database hasn't applied ${plugins.pending.length} plugin migration(s), starting with ${next.plugin} ${next.version}_${next.name}: run bogey plugins migrate`,
        });
      }
      const changed = changedNotice(plugins.changed);
      if (changed.length) issues.push({ message: changed.join(" ") });
    }
  }

  return issues;
}

function report(issues: Tuple<ConsistencyIssue>, notes: Tuple<string> = []): CliResult {
  const noteLines = notes.map((note) => `  • ${note}`);
  if (issues.length === 0) {
    return {
      exitCode: 0,
      output: ["✓ bogey doctor: no issues found", ...noteLines].join("\n"),
    };
  }
  const lines = issues.map((issue) => `  ✗ ${issue.message}`);
  return {
    exitCode: 1,
    output: [`bogey doctor: ${issues.length} issue(s) found`, ...lines, ...noteLines].join("\n"),
  };
}

export function runDoctor(cwd: string, run: Runner = spawnRunner): CliResult {
  return report(busy("Check this instance", () => localIssues(cwd, run)));
}

export async function runDoctorRemote(
  cwd: string,
  run: Runner = spawnRunner,
  fetcher: typeof fetch = fetch,
): Promise<CliResult> {
  const issues = step("Check this checkout", () => localIssues(cwd, run));
  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return report([...issues, { message: resolved.error }]);
  const root = findRepoRoot(cwd);
  const env = readEnv(join(root, ".env"));
  const remote = await step(`Check ${hostOf(resolved.credentials.url)}`, () =>
    remoteChecks({
      ...resolved.credentials,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY,
      accessToken: process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN,
      fetcher,
    }),
  );
  return report([...issues, ...remote.issues], remote.notes);
}
