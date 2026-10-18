import { COMMANDS } from "./commands.ts";
import { imageHome, imageNote } from "./lib/image.ts";
import type { Prompter } from "./lib/prompt.ts";
import { spawnRunner, type Runner } from "./lib/migrations.ts";
import { findRepoRoot } from "./lib/repo-root.ts";
import { newerRelease } from "./lib/release-status.ts";
import { expandShortFlags, SHORT_FLAGS, withShortFlags } from "./lib/short-flags.ts";
import { suggestCommands } from "./lib/suggest.ts";
import { runUpgrade } from "./commands/upgrade.ts";

export interface CliResult {
  exitCode: number;
  output: string;
  // false when the output is another program's (vp check, the tests), which bogey's hints don't read
  hints?: boolean;
}

function usage(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  return [
    "bogey: the Bogey CLI",
    "",
    "Commands:",
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    "",
    `Short flags: ${Object.entries(SHORT_FLAGS)
      .map(([letter, long]) => `-${letter} ${long}`)
      .join(", ")}`,
    "",
    "--no-input (or BOGEY_NO_INPUT=1) never asks: commands that need an answer say which flag gives it.",
    "",
    "bogey <command> --help (or -h) for details on a specific command, or bogey on its own for a menu",
  ].join("\n");
}

async function unknownCommand(
  name: string,
  rest: string[],
  cwd: string,
  prompter: Prompter | null,
  run: Runner,
): Promise<CliResult> {
  const unknown = `bogey: unknown command "${name}"`;
  const args = rest.length ? ` ${rest.join(" ")}` : "";
  const suggestions = suggestCommands(COMMANDS, name).map((command) => `bogey ${command}${args}`);
  if (suggestions.length === 1) {
    return { exitCode: 1, output: `${unknown}. Did you mean ${suggestions[0]}?` };
  }
  if (suggestions.length > 1) {
    return {
      exitCode: 1,
      output: [
        `${unknown}. Did you mean one of these?`,
        ...suggestions.map((line) => `  ${line}`),
      ].join("\n"),
    };
  }

  let root: string | null = null;
  try {
    root = findRepoRoot(cwd);
  } catch {
    root = null;
  }
  const newer = root ? newerRelease(root, run) : null;
  if (!newer) {
    return { exitCode: 1, output: `${unknown}. bogey --help lists the commands.` };
  }
  const explanation = `${unknown}. This Bogey is ${newer.current} and the latest is ${newer.latest}, which may have it.`;
  if (!prompter) {
    return { exitCode: 1, output: `${explanation}\nbogey upgrade brings it up to date.` };
  }
  prompter.say(explanation);
  const upgrade = await prompter.confirm({
    message: `Upgrade to ${newer.latest} now?`,
    initial: true,
  });
  if (!upgrade)
    return { exitCode: 1, output: "bogey upgrade brings it up to date when you're ready." };
  return runUpgrade(cwd, [], run);
}

export async function run(
  argv: string[],
  cwd: string = process.cwd(),
  prompter: Prompter | null = null,
  runner: Runner = spawnRunner,
): Promise<CliResult> {
  const [name, ...rest] = expandShortFlags(argv);
  if (!name || name === "--help" || name === "help") return { exitCode: 0, output: usage() };
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) return unknownCommand(name, rest, cwd, prompter, runner);
  // Anywhere in the line, so `bogey plugins migrate --help` explains instead of migrating.
  if (rest.includes("--help")) return { exitCode: 0, output: withShortFlags(command.usage) };
  const note = imageHome() ? imageNote(command, rest) : null;
  if (note) return { exitCode: 1, output: note };
  return command.run(cwd, rest, prompter);
}
