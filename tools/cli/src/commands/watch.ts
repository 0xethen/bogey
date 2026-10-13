import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import type { CliResult } from "../cli.ts";
import { generateThemes, watchThemes } from "./themes.ts";

interface Watcher {
  flag: string;
  description: string;
  start: (root: string, log: (line: string) => void) => () => void;
}

function regenerateSettings(root: string, log: (line: string) => void): void {
  const bin = join(root, "tools", "cli", "src", "bin.ts");
  for (const args of [["db", "baseline"], ["docs"]]) {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf-8" });
    log((result.stdout || result.stderr).trim());
  }
}

function regenerateEmail(root: string, log: (line: string) => void): void {
  const bin = join(root, "tools", "cli", "src", "bin.ts");
  const result = spawnSync(process.execPath, [bin, "email", "templates"], {
    cwd: root,
    encoding: "utf-8",
  });
  log((result.stdout || result.stderr).trim());
}

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
    flag: "--settings",
    description: "packages/config/src/settings.ts → SQL defaults, baseline, docs/reference",
    start: (root, log) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watcher = watch(join(root, "packages", "config", "src", "settings.ts"), () => {
        clearTimeout(timer);
        timer = setTimeout(() => regenerateSettings(root, log), 200);
      });
      return () => watcher.close();
    },
  },
  {
    flag: "--email",
    description:
      "packages/utils/templates/layout.html, packages/config/src/email.ts → layout.gen.ts, supabase/templates",
    start: (root, log) => {
      regenerateEmail(root, log);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onChange = () => {
        clearTimeout(timer);
        timer = setTimeout(() => regenerateEmail(root, log), 200);
      };
      const watchers = [
        watch(join(root, "packages", "utils", "templates"), onChange),
        watch(join(root, "packages", "config", "src", "email.ts"), onChange),
      ];
      return () => {
        for (const watcher of watchers) watcher.close();
      };
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
