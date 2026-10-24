import { run, type CliResult } from "./cli.ts";
import { COMMANDS } from "./commands.ts";
import { enableActivity, stopActivity } from "./lib/activity.ts";
import { explain } from "./lib/explain.ts";
import { invocation } from "./lib/invocation.ts";
import { present, reportable } from "./lib/present.ts";
import { Cancelled, terminalPrompter } from "./lib/prompt.ts";
import { offerReport } from "./lib/report.ts";
import { ISSUES_URL } from "./lib/repository.ts";
import { bad, bold, colorEnabled, dim, warn } from "./lib/style.ts";
import { runMenu } from "./menu.ts";
import { hasOrg } from "./commands/org.ts";

const argv = process.argv.slice(2).filter((arg) => arg !== "--no-input");
if (argv.length < process.argv.length - 2) process.env.BOGEY_NO_INPUT = "1";
const prefix = invocation();
const names = COMMANDS.map((command) => command.name);
const prompter = terminalPrompter();
if (process.stderr.isTTY) {
  enableActivity(
    process.stderr.fd,
    colorEnabled(process.env, true),
    () => process.stderr.columns || 80,
  );
}
const show = (result: CliResult, command?: string): string => {
  let text = result.output;
  try {
    text = present(result, prefix, COMMANDS, command);
  } catch {}
  if (result.exitCode === 0) console.log(text);
  else console.error(text);
  return text;
};

const report = async (text: string) => {
  if (!prompter) return;
  console.error();
  try {
    await offerReport(prompter, `$ ${[prefix || "bogey", ...argv].join(" ")}\n${text}`);
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
  }
};

async function crash(error: unknown): Promise<void> {
  stopActivity();
  const command =
    [prefix, names.includes(argv[0] ?? "") ? argv[0] : ""].filter(Boolean).join(" ") || "bogey";
  const message = error instanceof Error ? error.message : String(error);
  const lines = [
    "",
    bold(bad(`✗ ${command} stopped on an unexpected error:`)),
    `  ${message}`,
    ...explain(`${message}\n${error instanceof Error ? (error.stack ?? "") : ""}`).map(
      (hint) => `${warn("hint:")} ${hint}`,
    ),
    "",
    dim(`Report a bug at ${ISSUES_URL} with the following details:`),
    dim(error instanceof Error ? (error.stack ?? message) : message),
  ];
  console.error(lines.join("\n"));
  await report(lines.join("\n"));
}

try {
  if (argv.length === 0 && prompter) {
    await runMenu({
      prompter,
      prefix,
      run: (args) => run(args, process.cwd(), prompter),
      hasOrg: () => hasOrg(process.cwd()),
      show: (result, command) => {
        show(result, command);
        console.log();
      },
    });
    process.exit(0);
  }
  const result = await run(argv, process.cwd(), prompter);
  const command = names.includes(argv[0] ?? "") ? argv[0] : undefined;
  const text = show(result, command);
  process.exitCode = result.exitCode;
  if (reportable(result, command)) await report(text);
} catch (error) {
  if (error instanceof Cancelled) {
    stopActivity();
    console.error(dim("Cancelled."));
    process.exitCode = 130;
  } else {
    process.exitCode = 1;
    await crash(error);
  }
}
