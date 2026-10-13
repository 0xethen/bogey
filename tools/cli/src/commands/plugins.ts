import { unknownSubcommand } from "../lib/suggest.ts";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { PLUGIN_KEY } from "@bogey/utils/keys";
import { PLUGIN_API, SUPPORTED_PLUGIN_APIS } from "@bogey/plugins/api";
import {
  fetchLibrary,
  findListing,
  librarySchemas,
  listings,
  searchListings,
  type Listing,
} from "@bogey/plugins/library";
import { parseRepository } from "@bogey/plugins/api";
import {
  checkPluginUpdates,
  httpFetcher,
  type Fetcher,
  type UpdateSource,
} from "@bogey/plugins/updates";
import { releaseTerminal, terminalInput } from "../lib/terminal.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import { databaseUrl, NO_DATABASE_URL, serviceCredentials } from "../lib/credentials.ts";
import {
  applyPluginMigration,
  appliedPluginVersions,
  changedPluginMigrations,
  pendingPluginMigrations,
  pluginMigrationFiles,
  pluginMigrationScript,
  type PluginMigration,
  type PluginMigrationContext,
  spawnRunner,
  type Runner,
} from "../lib/migrations.ts";
import {
  fetchPlugin,
  hashDirectory,
  httpDownload,
  parseSpec,
  place,
  readLock,
  specSource,
  writeLock,
  type Download,
} from "../lib/plugin-install.ts";
import { verifyAsset } from "../lib/attestation.ts";
import {
  adoptStatement,
  emptyBucket,
  explainPsql,
  namedObjectsIn,
  pluginsInDatabase,
  removalPlan,
  removeFromDatabase,
} from "../lib/plugin-objects.ts";
import { linkPluginFolder } from "../lib/plugin-link.ts";
import { bundledPluginKeys, isBundled, pluginDir, pluginKeysOnDisk } from "../lib/plugin-dirs.ts";
import {
  normalizeLibrary,
  readLibraries,
  searchedLibraries,
  writeLibraries,
} from "../lib/libraries.ts";
import { step } from "../lib/activity.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey plugins: manage plugins (packages/plugins/installed/<key>, and bundled/<key> that ship with Bogey)

  bogey plugins list              Every installed plugin and whether it's disabled
  bogey plugins search [words]    Find plugins in the libraries this instance searches
  bogey plugins add <key>[@<version>] [--yes] [--force]
                      [--require-attestation] [--no-verify]
                                  Install a plugin from a library (the newest version unless one is named)
  bogey plugins add github:<owner>/<repo>/<plugin>@<version> [same flags]
                                  Install a release from a repository, after showing what it is and its SQL;
                                  checks GitHub's attestations with gh
  bogey plugins library [list]    The libraries searched: the official one, then bogey.libraries.json's
  bogey plugins library add github:<owner>/<repo>
  bogey plugins library remove github:<owner>/<repo>
  bogey plugins schema [index|libraries]   Print the JSON Schema of a library's index.json, or of bogey.libraries.json
  bogey plugins install           Restore the plugins in bogey.plugins.lock exactly
  bogey plugins link <folder>     Develop plugins in place: point installed/ at a checkout (and give
                                  it the node_modules its plugins need)
  bogey plugins info <key>        Version, author and where it's published
  bogey plugins outdated          Ask each plugin's repository for a newer version
  bogey plugins remove <key> [--yes] [--dry-run] [--db-url]
                                  Uninstall: drop everything its migrations made, its rows in
                                  Bogey's tables and its files; also clears plugins already deleted
  bogey plugins disable <key>     Keep it installed but switch it off for this instance
  bogey plugins enable <key>      Undo disable
  bogey plugins status [key...] [--db-url]    Which plugin migrations a database has applied
  bogey plugins migrate [key...] [--db-url]   Apply pending ones in order, each in a transaction
  bogey plugins sql [key...]        Print migrations + seed.sql for psql (all enabled plugins by default)
  bogey plugins new <key> --repo=github:you/repo   Scaffold a plugin`;

interface Paths {
  root: string;
  installed: string;
  disabledFile: string;
}

function paths(cwd: string): Paths {
  const root = findRepoRoot(cwd);
  return {
    root,
    installed: join(root, "packages", "plugins", "installed"),
    disabledFile: join(root, "bogey.config.ts"),
  };
}

export function installedPlugins(cwd: string): string[] {
  return pluginKeysOnDisk(findRepoRoot(cwd));
}

export interface ScannedPlugin {
  key: string;
  name: string;
  api: number | null;
  version: string;
  description: string;
  author: string | null;
  license: string | null;
  repository: string | null;
  directory: string | null;
  requires: string[];
  shares: { messages: boolean; sql: string[] };
}

function quotedList(body: string | undefined): string[] {
  return [...(body ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

function scan(dir: string, key: string): ScannedPlugin | null {
  let source: string;
  try {
    source = readFileSync(join(dir, "manifest.ts"), "utf-8");
  } catch {
    return null;
  }

  const field = (name: string) =>
    new RegExp(`^\\s*${name}:\\s*"([^"]*)"`, "m").exec(source)?.[1] ?? null;

  return {
    key,
    name: field("name") ?? key,
    api: Number(/^\s*api:\s*(\d+)/m.exec(source)?.[1]) || null,
    version: field("version") ?? "0.0.0",
    description: field("description") ?? "",
    author: /author:\s*\{[^}]*?name:\s*"([^"]*)"/s.exec(source)?.[1] ?? null,
    license: field("license"),
    repository: /source:\s*\{[^}]*?repository:\s*"([^"]*)"/s.exec(source)?.[1] ?? null,
    directory: /source:\s*\{[^}]*?directory:\s*"([^"]*)"/s.exec(source)?.[1] ?? null,
    requires: quotedList(/^\s*requires:\s*\[([^\]]*)\]/m.exec(source)?.[1]),
    shares: {
      messages: /^\s*shares:\s*\{[^}]*?messages:\s*true/ms.test(source),
      sql: quotedList(/^\s*shares:\s*\{[^}]*?sql:\s*\[([^\]]*)\]/ms.exec(source)?.[1]),
    },
  };
}

export function migrationContext(root: string, key: string): PluginMigrationContext {
  const requires = scan(pluginDir(root, key), key)?.requires ?? [];
  return {
    requires,
    shared: Object.fromEntries(
      requires.map((other) => [other, scan(pluginDir(root, other), other)?.shares.sql ?? []]),
    ),
  };
}

function requiredBy(root: string, key: string): string[] {
  return pluginKeysOnDisk(root).filter(
    (other) => other !== key && (scan(pluginDir(root, other), other)?.requires ?? []).includes(key),
  );
}

const DISABLED_LIST = /(plugins:\s*\{[\s\S]*?disabled:\s*)\[([\s\S]*?)\]/;

function readDisabled(file: string): string[] {
  if (!existsSync(file)) return [];
  const body = DISABLED_LIST.exec(readFileSync(file, "utf-8"))?.[2] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

function writeDisabled(file: string, keys: string[]): void {
  const source = readFileSync(file, "utf-8");
  const rendered = keys.length === 0 ? "[]" : `[${keys.map((k) => `"${k}"`).join(", ")}]`;
  writeFileSync(file, source.replace(DISABLED_LIST, `$1${rendered}`));
}

function list(cwd: string): CliResult {
  const { root, disabledFile } = paths(cwd);
  const disabled = readDisabled(disabledFile);
  const keys = pluginKeysOnDisk(root);

  if (keys.length === 0) {
    return {
      exitCode: 0,
      output: "No plugins installed. Put one in packages/plugins/installed/<key>/.",
    };
  }

  const rows = keys.map((key) => {
    const meta = scan(pluginDir(root, key), key);
    const fits =
      meta?.api !== null && meta?.api !== undefined && SUPPORTED_PLUGIN_APIS.includes(meta.api);
    const mark = disabled.includes(key) ? "off" : fits ? "on " : "!! ";
    if (!meta) return `  ${mark}  ${key}`;
    const from = isBundled(root, key) ? "ships with Bogey" : (meta.repository ?? "no source");
    return `  ${mark}  ${key.padEnd(16)} ${meta.version.padEnd(8)} ${from}`;
  });

  const stale = disabled.filter((key) => !keys.includes(key));
  if (rows.some((row) => row.startsWith("  !!"))) {
    rows.push(
      "",
      `!! = not written for plugin API ${SUPPORTED_PLUGIN_APIS.join(" or ")}; Bogey skips it.`,
    );
  }
  if (stale.length > 0) rows.push("", `Disabled but not installed: ${stale.join(", ")}`);

  return {
    exitCode: 0,
    output: `${rows.join("\n")}\n\n${keys.length - keys.filter((k) => disabled.includes(k)).length} of ${keys.length} enabled.`,
  };
}

function setDisabled(cwd: string, key: string, off: boolean): CliResult {
  const { root, disabledFile } = paths(cwd);
  if (!existsSync(join(pluginDir(root, key), "manifest.ts"))) {
    return { exitCode: 1, output: `bogey plugins: ${key} is not installed` };
  }

  const keys = readDisabled(disabledFile);
  if (off === keys.includes(key)) {
    return { exitCode: 0, output: `${key} is already ${off ? "disabled" : "enabled"}` };
  }

  writeDisabled(disabledFile, off ? [...keys, key] : keys.filter((existing) => existing !== key));
  return {
    exitCode: 0,
    output: off
      ? `Disabled ${key}. Its files, data and settings are untouched.`
      : `Enabled ${key}. Turn it on per org or event in Settings → Plugins.`,
  };
}

function info(cwd: string, key: string): CliResult {
  const { root, disabledFile } = paths(cwd);
  const dir = pluginDir(root, key);
  const meta = scan(dir, key);
  if (!meta) return { exitCode: 1, output: `bogey plugins: ${key} is not installed` };

  return {
    exitCode: 0,
    output: [
      `${meta.name}  ${meta.version}`,
      meta.description,
      "",
      `  key         ${meta.key}`,
      `  enabled     ${readDisabled(disabledFile).includes(key) ? "no" : "yes"}`,
      `  author      ${meta.author ?? "(not declared)"}`,
      `  license     ${meta.license ?? "(not declared)"}`,
      `  source      ${isBundled(root, key) ? "ships with Bogey (packages/plugins/bundled)" : (meta.repository ?? "(not declared)")}`,
      ...(meta.directory ? [`  directory   ${meta.directory}`] : []),
      `  migrations  ${pluginMigrationFiles(dir, key).length || "none"}`,
    ].join("\n"),
  };
}

function sql(cwd: string, requested: string[]): CliResult {
  const { root, disabledFile } = paths(cwd);
  const disabled = readDisabled(disabledFile);
  const keys =
    requested.length > 0
      ? requested
      : pluginKeysOnDisk(root).filter((key) => !disabled.includes(key));

  const parts: string[] = [];
  for (const key of keys) {
    const context = migrationContext(root, key);
    for (const migration of pluginMigrationFiles(pluginDir(root, key), key)) {
      const text = readFileSync(migration.path, "utf-8").trim();
      parts.push(
        `-- ─── plugin ${key}: ${migration.version}_${migration.name}\n\n${pluginMigrationScript(migration, context, text)}\n`,
      );
    }
    const seed = join(pluginDir(root, key), "seed.sql");
    if (existsSync(seed)) {
      parts.push(`-- ─── plugin ${key}: seed.sql\n\n${readFileSync(seed, "utf-8").trim()}\n`);
    }
  }

  return parts.length > 0
    ? { exitCode: 0, output: parts.join("\n") }
    : { exitCode: 0, output: "-- no plugin SQL" };
}

function scaffold(cwd: string, key: string, repository: string | null): CliResult {
  if (!PLUGIN_KEY.test(key)) {
    return {
      exitCode: 1,
      output: `bogey plugins: "${key}" must be 3-32 lowercase letters, digits and dashes`,
    };
  }
  if (!repository) {
    return { exitCode: 1, output: "bogey plugins: new needs --repo=github:you/repo" };
  }

  const { root, installed } = paths(cwd);
  const dir = join(installed, key);
  if (existsSync(dir) || isBundled(root, key)) {
    return { exitCode: 1, output: `bogey plugins: ${key} already exists` };
  }

  const title = key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.ts"), manifestTemplate(key, title, gitAuthor(cwd), repository));
  writeFileSync(join(dir, "runtime.tsx"), runtimeTemplate(title));

  return {
    exitCode: 0,
    output: [
      `Created packages/plugins/installed/${key}/.`,
      "",
      "  manifest.ts   settings, routes, windows and roles",
      "  runtime.tsx   what it renders",
      "",
      `It's served at /x/${key} once an org or event turns it on. See docs/plugins.md.`,
    ].join("\n"),
  };
}

function gitAuthor(cwd: string): { name: string; url?: string } {
  const read = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
    return result.status === 0 ? result.stdout.trim() : "";
  };
  const name = read("config", "user.name");
  const email = read("config", "user.email");
  if (!name) return { name: "Your name" };
  return email ? { name, url: `mailto:${email}` } : { name };
}

function manifestTemplate(
  key: string,
  title: string,
  author: { name: string; url?: string },
  repository: string,
): string {
  return `import { definePlugin } from "@bogey/plugins/api";

export const manifest = definePlugin({
  key: "${key}",
  name: "${title}",
  api: ${PLUGIN_API},
  version: "0.1.0",
  description: "One line an organizer reads when deciding to turn this on.",
  author: { name: ${JSON.stringify(author.name)}${author.url ? `, url: ${JSON.stringify(author.url)}` : ""} },
  license: "MIT",
  source: { repository: ${JSON.stringify(repository)} },
  settings: {
    greeting: { type: "string", label: "Greeting", default: "Hello" },
  },
  routes: [{ path: "", label: "${title}" }],
});

export default manifest;
`;
}

function runtimeTemplate(title: string): string {
  return `import { Panel } from "@bogey/ui/components/panel";
import { definePluginRuntime, type PluginContext } from "@bogey/plugins/runtime";
import type { SettingsOf } from "@bogey/plugins/types";
import { manifest } from "./manifest.ts";

type Settings = SettingsOf<typeof manifest>;

function Index({ settings }: PluginContext<Settings>) {
  return (
    <Panel title="${title}">
      <p className="text-sm text-muted-fg">{settings.greeting}</p>
    </Panel>
  );
}

export default definePluginRuntime(manifest, {
  routes: { "": Index },
});
`;
}

async function outdated(cwd: string): Promise<CliResult> {
  const { root, disabledFile } = paths(cwd);
  const disabled = readDisabled(disabledFile);

  const manifests: UpdateSource[] = pluginKeysOnDisk(root)
    .filter((key) => !disabled.includes(key) && !isBundled(root, key))
    .map((key) => scan(pluginDir(root, key), key))
    .filter((meta): meta is ScannedPlugin => meta !== null && meta.repository !== null)
    .map((meta) => ({
      key: meta.key,
      name: meta.name,
      version: meta.version,
      source: {
        repository: meta.repository!,
        ...(meta.directory ? { directory: meta.directory } : {}),
      },
    }));

  if (manifests.length === 0) return { exitCode: 0, output: "No enabled plugins to check." };

  const results = await step(`Check ${manifests.length} plugin(s) for updates`, () =>
    checkPluginUpdates(manifests, httpFetcher),
  );
  const stale = results.filter((result) => result.state === "outdated");
  const unknown = results.filter((result) => result.state === "unknown");

  const lines = results.map((result) => {
    if (result.state === "outdated") {
      return `  ↑   ${result.key.padEnd(16)} ${result.installed} → ${result.latest}${result.url ? `  ${result.url}` : ""}`;
    }
    if (result.state === "unknown") {
      return `  ?   ${result.key.padEnd(16)} ${result.installed}  couldn't check: ${result.detail}`;
    }
    return `  ✓   ${result.key.padEnd(16)} ${result.installed}`;
  });

  lines.push("", `${stale.length} of ${results.length} out of date.`);
  if (unknown.length > 0) lines.push(`${unknown.length} could not be checked.`);

  return { exitCode: stale.length > 0 ? 1 : 0, output: lines.join("\n") };
}

export type PluginMigrationState =
  | { ok: false; error: string }
  | {
      ok: true;
      files: PluginMigration[];
      pending: PluginMigration[];
      changed: PluginMigration[];
      applied: ReadonlyMap<string, string>;
    };

export function pluginMigrationState(
  cwd: string,
  url: string,
  run: Runner,
  keys: Tuple<string> = [],
): PluginMigrationState {
  const { root, disabledFile } = paths(cwd);
  const present = pluginKeysOnDisk(root);
  const unknown = keys.filter((key) => !present.includes(key));
  if (unknown.length) {
    return {
      ok: false,
      error: `bogey plugins: ${unknown.map((key) => `"${key}"`).join(", ")} ${unknown.length === 1 ? "isn't" : "aren't"} installed. bogey plugins list shows what is.`,
    };
  }
  const disabled = readDisabled(disabledFile);
  const chosen = keys.length ? keys : present.filter((key) => !disabled.includes(key));
  const files = chosen.flatMap((key) => pluginMigrationFiles(pluginDir(root, key), key));
  const applied = appliedPluginVersions(url, run);
  if (!applied.ok) return applied;
  return {
    ok: true,
    files,
    pending: pendingPluginMigrations(files, applied.versions),
    changed: changedPluginMigrations(files, applied.versions),
    applied: applied.versions,
  };
}

function adoptLegacy(
  root: string,
  url: string,
  run: Runner,
  keys: Tuple<string>,
  applied: (file: PluginMigration) => boolean = () => true,
): { ok: true; lines: string[] } | { ok: false; label: string; error: string } {
  if (keys.length === 0) return { ok: true, lines: [] };
  const known = pluginsInDatabase(url, run);
  if (!known.ok) return { ok: false, label: "read the plugin records", error: known.error };
  const lines: string[] = [];
  for (const key of keys.filter((each) => !known.plugins.get(each)?.objects)) {
    const files = pluginMigrationFiles(pluginDir(root, key), key).filter(applied);
    if (files.length === 0) continue;
    const adopt = adoptStatement(key, namedObjectsIn(files));
    const result = step(`Record what ${key} made before`, () =>
      run(
        "psql",
        [url, "-At", "-q", "-f", "-"],
        `\\set ON_ERROR_STOP on\nbegin;\n${adopt}\nselect count(*) from bogey_adopted;\ncommit;`,
      ),
    );
    if (result.status !== 0) {
      return { ok: false, label: `record ${key}'s objects`, error: explainPsql(result) };
    }
    const count = Number(result.stdout.trim());
    if (count > 0) lines.push(`✓ recorded ${count} objects ${key} made before Bogey kept a record`);
  }
  return { ok: true, lines };
}

function applyPending(
  root: string,
  url: string,
  run: Runner,
  state: Extract<PluginMigrationState, { ok: true }>,
): { done: string[]; failed?: { label: string; error: string } } {
  const untracked = [...new Set(state.pending.map((file) => file.plugin))].filter((key) =>
    [...state.applied.keys()].some((applied) => applied.startsWith(`${key}:`)),
  );
  const adopted = adoptLegacy(root, url, run, untracked, (file) => !state.pending.includes(file));
  if (!adopted.ok) return { done: [], failed: { label: adopted.label, error: adopted.error } };
  const done = [...adopted.lines];
  for (const migration of state.pending) {
    const label = `${migration.plugin} ${migration.version}_${migration.name}`;
    const context = migrationContext(root, migration.plugin);
    const result = step(`Apply ${label}`, () => applyPluginMigration(url, migration, run, context));
    if (result.status !== 0) return { done, failed: { label, error: explainPsql(result) } };
    done.push(`✓ applied ${label}`);
  }
  return { done };
}

export function migrateBundledPlugins(
  cwd: string,
  url: string,
  run: Runner,
  dryRun = false,
): { ok: true; lines: string[] } | { ok: false; lines: string[]; error: string } {
  const { root, disabledFile } = paths(cwd);
  const disabled = readDisabled(disabledFile);
  const keys = bundledPluginKeys(root).filter((key) => !disabled.includes(key));
  if (keys.length === 0) return { ok: true, lines: [] };
  const state = pluginMigrationState(cwd, url, run, keys);
  if (!state.ok) return { ok: false, lines: [], error: state.error };
  if (dryRun) {
    return {
      ok: true,
      lines: state.pending.map((file) => `would apply ${file.plugin} ${file.version}_${file.name}`),
    };
  }
  const { done, failed } = applyPending(root, url, run, state);
  if (failed) {
    return {
      ok: false,
      lines: done,
      error: `Plugin migration ${failed.label} failed and was rolled back:\n${failed.error}`,
    };
  }
  return { ok: true, lines: [...done, ...changedNotice(state.changed)] };
}

export function changedNotice(changed: Tuple<PluginMigration>): string[] {
  if (changed.length === 0) return [];
  return [
    `${changed.length} applied migration(s) changed since the database ran them: ${changed.map((file) => `${file.plugin} ${file.version}_${file.name}`).join(", ")}.`,
    "An applied migration never runs again, so the database still has the old version. Put the change in a new migration.",
  ];
}

function migrations(
  cwd: string,
  action: "status" | "migrate",
  args: string[],
  run: Runner,
): CliResult {
  const url = databaseUrl(cwd, parseFlags(args)["db-url"]);
  if (!url) return { exitCode: 1, output: NO_DATABASE_URL };

  const requested = args.filter(
    (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--db-url",
  );
  const state = pluginMigrationState(cwd, url, run, requested);
  if (!state.ok) return { exitCode: 1, output: state.error };
  const { files, pending: todo, changed } = state;
  const notice = changedNotice(changed);

  if (action === "status") {
    const left = leftovers(cwd, url, run);
    if (files.length === 0) {
      return { exitCode: 0, output: ["No plugin migrations.", ...left].join("\n") };
    }
    const lines = files.map(
      (file) =>
        `  ${todo.includes(file) ? "○ pending" : changed.includes(file) ? "! changed" : "✓ applied"}  ${file.plugin}  ${file.version}_${file.name}`,
    );
    return {
      exitCode: 0,
      output: [
        ...lines,
        "",
        todo.length ? `${todo.length} pending: \`bogey plugins migrate\`` : "✓ Up to date.",
        ...notice,
        ...left,
      ].join("\n"),
    };
  }

  if (todo.length === 0) {
    return {
      exitCode: 0,
      output: ["✓ Nothing to apply. Plugins are up to date!", ...notice].join("\n"),
    };
  }
  if (args.includes("--dry-run")) {
    return {
      exitCode: 0,
      output: [
        ...todo.map((file) => `would apply ${file.plugin} ${file.version}_${file.name}`),
        ...notice,
      ].join("\n"),
    };
  }
  const { done, failed } = applyPending(findRepoRoot(cwd), url, run, state);
  if (failed) {
    return {
      exitCode: 1,
      output: [
        `Plugin migration ${failed.label} failed and was rolled back${done.length ? "; the ones before it stay applied" : ""}.`,
        ...done,
        `✗ failed ${failed.label}:`,
        failed.error,
      ].join("\n"),
    };
  }
  return { exitCode: 0, output: [...done, ...notice].join("\n") };
}

function leftovers(cwd: string, url: string, run: Runner): string[] {
  const known = pluginsInDatabase(url, run);
  if (!known.ok) return [];
  const present = pluginKeysOnDisk(findRepoRoot(cwd));
  const gone = [...known.plugins.keys()].filter((key) => !present.includes(key));
  if (gone.length === 0) return [];
  return [
    "",
    `In the database but not installed: ${gone.join(", ")}.`,
    "`bogey plugins remove <key>` clears what each left behind.",
  ];
}

export type Confirm = (question: string) => Promise<boolean>;

const askOnTerminal: Confirm = async (question) => {
  const input = terminalInput();
  if (!input) return false;
  const terminal = createInterface({ input, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await terminal.question(`${question} [y/N] `)).trim());
  } finally {
    terminal.close();
    releaseTerminal();
  }
};

export interface PluginDeps {
  download?: Download;
  fetcher?: Fetcher;
  confirm?: Confirm;
  say?: (text: string) => void;
}

function manifestKey(manifest: string): string | null {
  return /^\s*key:\s*"([^"]*)"/m.exec(manifest)?.[1] ?? null;
}

function usesBlock(manifest: string): string | null {
  return (
    /^ {2}uses:\s*\{[\s\S]*?\n {2}\},?$|^ {2}uses:\s*\{[^\n]*\},?$/m.exec(manifest)?.[0] ?? null
  );
}

async function add(
  cwd: string,
  specText: string,
  args: string[],
  run: Runner,
  deps: PluginDeps,
): Promise<CliResult> {
  const spec = await resolveSpec(cwd, specText, deps.fetcher ?? httpFetcher);
  if (typeof spec === "string") return { exitCode: 1, output: `bogey plugins: ${spec}` };
  const flags = parseFlags(args);
  const root = findRepoRoot(cwd);
  const { installed } = paths(cwd);
  const lock = readLock(root);
  const say = deps.say ?? ((text: string) => process.stdout.write(`${text}\n`));

  if (isBundled(root, spec.plugin)) {
    return {
      exitCode: 1,
      output: `bogey plugins: ${spec.plugin} ships with Bogey (packages/plugins/bundled), so there's nothing to install. Turn it on for an org or event in Settings → Plugins.`,
    };
  }
  if (existsSync(join(installed, spec.plugin)) && !lock[spec.plugin] && flags.force !== true) {
    return {
      exitCode: 1,
      output: `bogey plugins: ${spec.plugin} is already in packages/plugins/installed and bogey didn't put it there. --force replaces it.`,
    };
  }

  const got = await step(`Download ${spec.plugin} ${spec.version}`, () =>
    fetchPlugin(spec, deps.download ?? httpDownload, run),
  );
  if (!got.ok) return { exitCode: 1, output: `bogey plugins: ${got.error}` };
  const { dir, integrity, cleanup } = got.fetched;
  try {
    const meta = scan(dir, spec.plugin);
    const manifest = readFileSync(join(dir, "manifest.ts"), "utf-8");
    if (!meta || manifestKey(manifest) !== spec.plugin) {
      return {
        exitCode: 1,
        output: `bogey plugins: the release's manifest doesn't declare the key "${spec.plugin}"`,
      };
    }
    if (meta.version !== spec.version) {
      return {
        exitCode: 1,
        output: `bogey plugins: the tag says ${spec.version} but its manifest says ${meta.version}`,
      };
    }
    if (meta.api === null || !SUPPORTED_PLUGIN_APIS.includes(meta.api)) {
      return {
        exitCode: 1,
        output: `bogey plugins: ${spec.plugin} targets plugin API ${meta.api ?? "?"}; this Bogey supports ${SUPPORTED_PLUGIN_APIS.join(" or ")}`,
      };
    }

    const verification =
      flags["no-verify"] === true
        ? null
        : verifyAsset(
            got.fetched.archive,
            `${spec.plugin}-v${spec.version}`,
            { owner: spec.owner, repo: spec.repo },
            run,
          );
    if (flags["require-attestation"] === true && (verification?.assurance ?? "none") === "none") {
      return {
        exitCode: 1,
        output: `bogey plugins: --require-attestation, but ${verification?.detail ?? "verification was skipped (--no-verify)"}`,
      };
    }

    const migrationFiles = pluginMigrationFiles(dir, spec.plugin);
    const seed = existsSync(join(dir, "seed.sql"));
    const summary = [
      `${meta.name} ${meta.version}  (${specSource(spec)})`,
      meta.description,
      "",
      `  author     ${meta.author ?? "(not declared)"}`,
      `  license    ${meta.license ?? "(not declared)"}`,
      `  plugin API ${meta.api}`,
      `  integrity  ${integrity}`,
      `  verified   ${
        !verification
          ? "skipped (--no-verify)"
          : verification.assurance === "none"
            ? `NO: ${verification.detail}`
            : verification.detail
      }`,
      "",
      "A plugin is trusted code: it runs in the app with the app's privileges, and its SQL runs",
      "against your database. Read it.",
    ];
    const uses = usesBlock(manifest);
    summary.push("", uses ? `It says it uses:\n${uses}` : "It doesn't say what it uses.");
    if (migrationFiles.length === 0 && !seed) summary.push("", "It has no SQL.");
    for (const migration of migrationFiles) {
      summary.push(
        "",
        `-- migration ${migration.version}_${migration.name}`,
        readFileSync(migration.path, "utf-8").trim(),
      );
    }
    say(summary.join("\n"));

    if (flags.yes !== true) {
      const ask = deps.confirm ?? askOnTerminal;
      if (!(await ask(`Install ${spec.plugin} ${spec.version}?`))) {
        return {
          exitCode: 1,
          output:
            "Not installed. Nothing was changed. (Without a terminal, pass --yes once you've read it.)",
        };
      }
    }

    place(installed, spec.plugin, dir);
    writeLock(root, {
      ...lock,
      [spec.plugin]: {
        source: specSource(spec),
        version: spec.version,
        integrity,
        ...(verification && verification.assurance !== "none"
          ? { attestation: verification.assurance }
          : {}),
      },
    });
    return {
      exitCode: 0,
      output: [
        `Installed ${spec.plugin} ${spec.version} and locked it in bogey.plugins.lock.`,
        "",
        "Next:",
        ...(migrationFiles.length > 0
          ? ["  bogey plugins migrate --db-url postgres://...   apply its SQL"]
          : []),
        "  rebuild and redeploy the app (a plugin is part of the build)",
        `  turn it on for an org or event in Settings → Plugins`,
      ].join("\n"),
    };
  } finally {
    cleanup();
  }
}

async function remove(
  cwd: string,
  key: string,
  args: string[],
  run: Runner,
  deps: PluginDeps,
): Promise<CliResult> {
  const flags = parseFlags(args);
  const root = findRepoRoot(cwd);
  const { installed, disabledFile } = paths(cwd);
  const say = deps.say ?? ((text: string) => process.stdout.write(`${text}\n`));

  if (!PLUGIN_KEY.test(key)) {
    return { exitCode: 1, output: `bogey plugins: "${key}" isn't a plugin key` };
  }
  if (isBundled(root, key)) {
    return {
      exitCode: 1,
      output: `bogey plugins: ${key} ships with Bogey, so it can't be removed. \`bogey plugins disable ${key}\` switches it off.`,
    };
  }
  const needing = requiredBy(root, key);
  if (needing.length > 0) {
    return {
      exitCode: 1,
      output: `bogey plugins: ${needing.join(", ")} ${needing.length === 1 ? "requires" : "require"} ${key}. Remove ${needing.length === 1 ? "it" : "them"} first.`,
    };
  }
  const url = databaseUrl(cwd, flags["db-url"]);
  if (!url) return { exitCode: 1, output: NO_DATABASE_URL };

  const dir = join(installed, key);
  const onDisk = existsSync(join(dir, "manifest.ts"));
  const known = pluginsInDatabase(url, run);
  if (!known.ok) return { exitCode: 1, output: `bogey plugins: ${known.error}` };
  const record = known.plugins.get(key);
  if (!record?.objects && !onDisk) {
    const others = pluginKeysOnDisk(root).filter((other) => known.plugins.get(other)?.migrations);
    const adopted = adoptLegacy(root, url, run, others);
    if (!adopted.ok)
      return { exitCode: 1, output: `bogey plugins: ${adopted.label}: ${adopted.error}` };
    for (const line of adopted.lines) say(line);
  }
  const adopt = record?.objects
    ? null
    : adoptStatement(key, onDisk ? namedObjectsIn(pluginMigrationFiles(dir, key)) : null);
  const planned = step(`Read what ${key} left in the database`, () =>
    removalPlan(url, key, adopt, run),
  );
  if (!planned.ok) return { exitCode: 1, output: `bogey plugins: ${planned.error}` };
  const { plan } = planned;
  const inLock = Boolean(readLock(root)[key]);

  if (
    !onDisk &&
    !inLock &&
    plan.objects.length === 0 &&
    plan.rows.length === 0 &&
    !plan.migrations
  ) {
    return { exitCode: 0, output: `Nothing of ${key} is installed or in the database.` };
  }

  const linked = existsSync(installed) && lstatSync(installed).isSymbolicLink();
  const summary = [`Removing ${key} takes out:`];
  if (plan.objects.length > 0) {
    summary.push("", "  from the database", ...plan.objects.map((line) => `    ${line}`));
  }
  if (plan.adopted.length > 0) {
    summary.push(
      "",
      `  Bogey has no record of what ${key} made (it was migrated before Bogey kept one), so the`,
      `  objects above were found by ${onDisk ? "the names its migrations use" : `their names, which start with "${key.replace(/-/g, "_")}_"`}. Check them.`,
    );
  }
  if (plan.rows.length > 0) {
    summary.push("", "  in Bogey's tables", ...plan.rows.map((line) => `    ${line}`));
  }
  for (const bucket of plan.buckets) {
    summary.push("", `  the ${bucket.files} files in storage bucket ${bucket.id}`);
  }
  if (plan.migrations > 0)
    summary.push("", `  the record of its ${plan.migrations} applied migrations`);
  if (onDisk) {
    summary.push(
      "",
      linked
        ? `  nothing on disk: installed/ is a linked checkout, so its folder stays there and ${key} is disabled in bogey.config.ts`
        : `  packages/plugins/installed/${key}/${inLock ? " and its bogey.plugins.lock entry" : ""}`,
    );
  } else if (inLock) {
    summary.push("", "  its bogey.plugins.lock entry");
  }
  summary.push(
    "",
    "What organizers made with it stays as it is while the plugin is off: sessions of its types,",
    "form items and their answers, rounds ranked by its methods, and the audit log.",
  );

  if (plan.blockers.length > 0) {
    return {
      exitCode: 1,
      output: [
        ...summary,
        "",
        `${key} can't be removed while something else builds on it:`,
        ...plan.blockers.map((line) => `  - ${line}`),
      ].join("\n"),
    };
  }
  if (flags["dry-run"] === true) return { exitCode: 0, output: summary.join("\n") };

  say(summary.join("\n"));
  if (flags.yes !== true) {
    const ask = deps.confirm ?? askOnTerminal;
    if (!(await ask(`Remove ${key}? This deletes its data.`))) {
      return {
        exitCode: 1,
        output: "Nothing was removed. (Without a terminal, pass --yes once you've read it.)",
      };
    }
  }

  if (plan.buckets.length > 0) {
    const credentials = serviceCredentials(cwd);
    if (!credentials.ok) {
      return {
        exitCode: 1,
        output: `bogey plugins: ${key}'s buckets hold files, which only the Storage API deletes.\n${credentials.error}\nNothing was removed.`,
      };
    }
    for (const bucket of plan.buckets) {
      const emptied = await emptyBucket(credentials.credentials, bucket.id);
      if (!emptied.ok) {
        return {
          exitCode: 1,
          output: `bogey plugins: couldn't empty storage bucket ${bucket.id}: ${emptied.error}\nNothing else was removed.`,
        };
      }
    }
  }

  const removed = step(`Remove ${key} from the database`, () =>
    removeFromDatabase(url, key, adopt, run),
  );
  if (removed.status !== 0) {
    return {
      exitCode: 1,
      output: `bogey plugins: removing ${key} from the database failed and was rolled back; its files are untouched.\n${explainPsql(removed)}`,
    };
  }

  const lines = removed.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => `✓ ${line}`);
  if (onDisk) {
    if (linked) {
      const disabled = readDisabled(disabledFile);
      if (!disabled.includes(key)) writeDisabled(disabledFile, [...disabled, key]);
      lines.push(`✓ disabled ${key} in bogey.config.ts (installed/ is linked; its folder stays)`);
    } else {
      rmSync(dir, { recursive: true, force: true });
      lines.push(`✓ deleted packages/plugins/installed/${key}`);
    }
  }
  if (!linked || !onDisk) {
    const disabled = readDisabled(disabledFile);
    if (disabled.includes(key)) {
      writeDisabled(
        disabledFile,
        disabled.filter((each) => each !== key),
      );
    }
  }
  if (inLock) {
    writeLock(
      root,
      Object.fromEntries(Object.entries(readLock(root)).filter(([locked]) => locked !== key)),
    );
    lines.push("✓ removed it from bogey.plugins.lock");
  }
  return {
    exitCode: 0,
    output: [
      ...lines,
      "",
      `Removed ${key}.${onDisk && !linked ? " Rebuild and redeploy the app (a plugin is part of the build)." : ""}`,
    ].join("\n"),
  };
}

async function restore(cwd: string, run: Runner, deps: PluginDeps): Promise<CliResult> {
  const root = findRepoRoot(cwd);
  const { installed } = paths(cwd);
  const lock = readLock(root);
  const keys = Object.keys(lock).sort();
  if (keys.length === 0) return { exitCode: 0, output: "bogey.plugins.lock is empty." };

  const lines: string[] = [];
  for (const key of keys) {
    const entry = lock[key];
    if (!entry) continue;
    if (isBundled(root, key)) {
      lines.push(`- skipped   ${key}: it ships with Bogey now; remove it from bogey.plugins.lock`);
      continue;
    }
    const dir = join(installed, key);
    if (existsSync(dir) && hashDirectory(dir) === entry.integrity) {
      lines.push(`✓ ok        ${key} ${entry.version}`);
      continue;
    }
    const spec = parseSpec(`${entry.source}@${entry.version}`);
    if (typeof spec === "string") return { exitCode: 1, output: `bogey plugins: ${key}: ${spec}` };
    const got = await step(`Download ${key} ${entry.version}`, () =>
      fetchPlugin(spec, deps.download ?? httpDownload, run),
    );
    if (!got.ok)
      return { exitCode: 1, output: [...lines, `bogey plugins: ${key}: ${got.error}`].join("\n") };
    try {
      if (got.fetched.integrity !== entry.integrity) {
        return {
          exitCode: 1,
          output: [
            ...lines,
            `bogey plugins: ${key} ${entry.version} doesn't match the lock. The release changed after it was locked, so nothing was installed for it.`,
          ].join("\n"),
        };
      }
      place(installed, key, got.fetched.dir);
      lines.push(`✓ restored  ${key} ${entry.version}`);
    } finally {
      got.fetched.cleanup();
    }
  }
  return { exitCode: 0, output: lines.join("\n") };
}

async function readAll(
  root: string,
  fetcher: Fetcher,
): Promise<{ all: Listing[]; problems: string[] } | string> {
  const sources = searchedLibraries(root);
  if (typeof sources === "string") return sources;
  const fetched = await Promise.all(sources.map((source) => fetchLibrary(source, fetcher)));
  return {
    all: listings(fetched),
    problems: fetched.flatMap((each) => (each.ok ? [] : [`${each.source} ${each.error}`])),
  };
}

async function resolveSpec(
  cwd: string,
  text: string,
  fetcher: Fetcher,
): Promise<ReturnType<typeof parseSpec>> {
  if (text.startsWith("github:")) return parseSpec(text);
  const [key = "", version] = text.split("@");
  if (!PLUGIN_KEY.test(key))
    return `"${text}" isn't a plugin key, or github:<owner>/<repo>/<plugin>@<version>`;
  const read = await readAll(findRepoRoot(cwd), fetcher);
  if (typeof read === "string") return read;
  const listing = findListing(read.all, key);
  if (typeof listing === "string") {
    return read.problems.length > 0 ? `${listing} (${read.problems.join("; ")})` : listing;
  }
  const repository = parseRepository(listing.repository);
  if (!repository)
    return `${listing.library} names a repository Bogey can't read: ${listing.repository}`;
  return parseSpec(
    `github:${repository.owner}/${repository.repo}/${key}@${version ?? listing.version}`,
  );
}

async function search(cwd: string, words: string[], fetcher: Fetcher): Promise<CliResult> {
  const read = await readAll(findRepoRoot(cwd), fetcher);
  if (typeof read === "string") return { exitCode: 1, output: `bogey plugins: ${read}` };
  const found = searchListings(read.all, words.join(" "));
  const lines =
    found.length === 0
      ? ["No plugin matches."]
      : found.map((plugin) => {
          const fits = plugin.api !== null && SUPPORTED_PLUGIN_APIS.includes(plugin.api);
          return `  ${fits ? " " : "!"} ${plugin.key.padEnd(16)} ${plugin.version.padEnd(8)} ${plugin.description}\n      ${plugin.library}`;
        });
  if (found.some((plugin) => plugin.api === null || !SUPPORTED_PLUGIN_APIS.includes(plugin.api))) {
    lines.push("", `! = not written for plugin API ${SUPPORTED_PLUGIN_APIS.join(" or ")}.`);
  }
  if (read.problems.length > 0)
    lines.push("", ...read.problems.map((problem) => `Skipped: ${problem}`));
  return { exitCode: 0, output: lines.join("\n") };
}

function library(cwd: string, args: string[]): CliResult {
  const root = findRepoRoot(cwd);
  const [action = "list", source] = args;
  const own = readLibraries(root);
  if (typeof own === "string") return { exitCode: 1, output: `bogey plugins: ${own}` };

  if (action === "list") {
    return {
      exitCode: 0,
      output: [
        "Searched, in this order:",
        `  github:0xethen/bogeyx  (official)`,
        ...own.map((each) => `  ${each}`),
      ].join("\n"),
    };
  }
  if (action !== "add" && action !== "remove") {
    return { exitCode: 1, output: `bogey plugins: unknown library action "${action}"\n\n${USAGE}` };
  }
  if (!source)
    return { exitCode: 1, output: `bogey plugins: library ${action} needs github:<owner>/<repo>` };
  let normal: string;
  try {
    normal = normalizeLibrary(source);
  } catch (error) {
    return {
      exitCode: 1,
      output: `bogey plugins: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const present = own.includes(normal);
  if (action === "add") {
    if (present) return { exitCode: 0, output: `${normal} is already searched` };
    writeLibraries(root, [...own, normal]);
    return {
      exitCode: 0,
      output: `Added ${normal} to bogey.libraries.json. Plugins are code that runs with the app's privileges: add only libraries you trust.`,
    };
  }
  if (!present) return { exitCode: 0, output: `${normal} isn't in bogey.libraries.json` };
  writeLibraries(
    root,
    own.filter((each) => each !== normal),
  );
  return { exitCode: 0, output: `Removed ${normal}. Plugins already installed from it stay.` };
}

function schema(which: string | undefined): CliResult {
  const schemas = librarySchemas();
  if (which === undefined || which === "index") {
    return { exitCode: 0, output: JSON.stringify(schemas.index, null, 2) };
  }
  if (which === "libraries")
    return { exitCode: 0, output: JSON.stringify(schemas.libraries, null, 2) };
  return { exitCode: 1, output: `bogey plugins: schema is index or libraries\n\n${USAGE}` };
}

const KEYED: Tuple<string> = ["add", "remove", "info", "enable", "disable", "new"];

export const SUBCOMMANDS: Tuple<string> = [
  "list",
  "outdated",
  "search",
  "library",
  "schema",
  "install",
  "link",
  "sql",
  "status",
  "migrate",
  ...KEYED,
];

export async function runPlugins(
  cwd: string,
  args: string[],
  run: Runner = spawnRunner,
  deps: PluginDeps = {},
): Promise<CliResult> {
  const [action, ...rest] = args;
  const key = rest.find((arg) => !arg.startsWith("--"));

  if (!action || action === "list") return list(cwd);
  if (action === "outdated") return outdated(cwd);
  if (action === "search") {
    return search(
      cwd,
      rest.filter((arg) => !arg.startsWith("--")),
      deps.fetcher ?? httpFetcher,
    );
  }
  if (action === "library")
    return library(
      cwd,
      rest.filter((arg) => !arg.startsWith("--")),
    );
  if (action === "schema") return schema(key);
  if (action === "install") return restore(cwd, run, deps);
  if (action === "link") {
    const folder = rest.find((arg) => !arg.startsWith("--"));
    if (!folder) return { exitCode: 1, output: `bogey plugins: link needs a folder\n\n${USAGE}` };
    const linked = linkPluginFolder(findRepoRoot(cwd), folder);
    return linked.ok
      ? { exitCode: 0, output: linked.lines.join("\n") }
      : { exitCode: 1, output: `bogey plugins: ${linked.error}` };
  }
  if (action === "sql") return sql(cwd, rest);
  if (action === "status" || action === "migrate") return migrations(cwd, action, rest, run);

  if (!KEYED.includes(action)) {
    return { exitCode: 1, output: unknownSubcommand("plugins", action, SUBCOMMANDS) };
  }
  if (!key) {
    return { exitCode: 1, output: `bogey plugins: ${action} needs a plugin key\n\n${USAGE}` };
  }

  switch (action) {
    case "add":
      return add(cwd, key, rest, run, deps);
    case "remove":
      return remove(cwd, key, rest, run, deps);
    case "info":
      return info(cwd, key);
    case "enable":
      return setDisabled(cwd, key, false);
    case "disable":
      return setDisabled(cwd, key, true);
    case "new": {
      const flag = rest.find((arg) => arg.startsWith("--repo="));
      return scaffold(cwd, key, flag ? flag.slice("--repo=".length) : null);
    }
    default:
      return { exitCode: 1, output: unknownSubcommand("plugins", action, SUBCOMMANDS) };
  }
}
