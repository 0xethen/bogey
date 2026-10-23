import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import type { CliResult } from "../cli.ts";
import { generateThemes, watchThemes } from "./themes.ts";
import { watchInputs } from "../lib/watch-inputs.ts";
import { generateSchemaTypes, watchSchemaTypes } from "../lib/schema-types.ts";

interface Watcher {
  flag: string;
  description: string;
  start: (root: string, log: (line: string) => void) => () => void;
}

function bogey(root: string, args: string[]) {
  const bin = join(root, "tools", "cli", "src", "bin.ts");
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf-8" });
}

// Runs a generator only when its --check says the output is stale, and prints only then.
function regenerate(root: string, log: (line: string) => void, commands: string[][]): void {
  for (const args of commands) {
    if (bogey(root, [...args, "--check"]).status === 0) continue;
    const result = bogey(root, args);
    log((result.stdout || result.stderr).trim());
  }
}

const SETTINGS_INPUTS = [
  "packages/config/src/settings.ts",
  "packages/config/src/notifications.ts",
  "packages/config/src/windows.ts",
  "packages/config/src/email.ts",
  "supabase/schemas",
  "tools/cli/src/commands",
  "tools/cli/src/commands.ts",
];

const EMAIL_INPUTS = ["packages/utils/templates", "packages/config/src/email.ts"];

const WATCHERS: Tuple<Watcher> = [
  {
    flag: "--themes",
    description: "packages/ui/src/styles/themes → themes.css and @bogey/config/themes",
    start: (root, log) => {
      log(generateThemes(root).output);
      return watchThemes(root, log);
    },
  },
  {
    flag: "--schema",
    description:
      "supabase/schemas → packages/db/src/types/schema.gen.ts (permissions, audit actions, checks)",
    start: (root, log) => {
      log(generateSchemaTypes(root).output);
      return watchSchemaTypes(root, log);
    },
  },
  {
    flag: "--settings",
    description: "packages/config/src/settings.ts → SQL defaults, baseline, docs/reference",
    start: (root, log) =>
      watchInputs(root, SETTINGS_INPUTS, () =>
        regenerate(root, log, [["db", "baseline"], ["docs"]]),
      ),
  },
  {
    flag: "--email",
    description:
      "packages/utils/templates/layout.html, packages/config/src/email.ts → layout.gen.ts, supabase/templates",
    start: (root, log) => {
      regenerate(root, log, [["email", "templates"]]);
      return watchInputs(root, EMAIL_INPUTS, () => regenerate(root, log, [["email", "templates"]]));
    },
  },
];

export const USAGE = `bogey watch [${WATCHERS.map((watcher) => watcher.flag).join("] [")}]

Regenerates files derived from the repo while you work (\`pnpm dev\` runs it).
With no flags, runs every watcher.

${WATCHERS.map((watcher) => `  ${watcher.flag.padEnd(11)} ${watcher.description}`).join("\n")}`;

export function runWatch(cwd: string, args: string[]): CliResult | Promise<CliResult> {
  if (args.includes("--help")) return { exitCode: 0, output: USAGE };
  const unknown = args.filter((arg) => !WATCHERS.some((watcher) => watcher.flag === arg));
  if (unknown.length) {
    return { exitCode: 1, output: `bogey watch: unknown ${unknown.join(", ")}\n\n${USAGE}` };
  }
  const chosen = args.length ? WATCHERS.filter((watcher) => args.includes(watcher.flag)) : WATCHERS;
  const root = findRepoRoot(cwd);
  const stops = chosen.map((watcher) => watcher.start(root, console.log));
  return new Promise((resolve) => {
    process.once("SIGINT", () => {
      for (const stop of stops) stop();
      resolve({ exitCode: 0, output: "bogey watch: stopped" });
    });
  });
}
