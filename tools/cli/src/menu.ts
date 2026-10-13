import type { CliResult } from "./cli.ts";
import { Cancelled, intro, type Choice, type Prompter } from "./lib/prompt.ts";

interface Entry {
  label: string;
  group: string;
  command: string;
  args?: string[];
  ask?: Tuple<{
    question: string;
    hint?: string;
    flag?: string;
    positional?: boolean;
    required?: boolean;
  }>;
  confirm?: string;
}

export const MENU: Tuple<Entry> = [
  { group: "Get started", label: "Set up .env", command: "setup" },
  {
    group: "Get started",
    label: "Create the first organization",
    command: "org",
    args: ["init"],
  },
  { group: "Get started", label: "Check this instance", command: "doctor" },
  {
    group: "Organizations and people",
    label: "List organizations",
    command: "org",
    args: ["list"],
  },
  {
    group: "Organizations and people",
    label: "Add an organization",
    command: "org",
    args: ["create"],
  },
  {
    group: "Organizations and people",
    label: "Get a sign-in code, without email",
    command: "login",
  },
  { group: "Plugins", label: "List plugins", command: "plugins", args: ["list"] },
  { group: "Plugins", label: "Check plugins for updates", command: "plugins", args: ["outdated"] },
  {
    group: "Plugins",
    label: "Install a plugin",
    command: "plugins",
    args: ["add"],
    ask: [
      {
        question: "Plugin",
        hint: "github:<owner>/<repo>/<plugin>@<version>",
        positional: true,
        required: true,
      },
    ],
  },
  {
    group: "Upkeep",
    label: "Upgrade Bogey",
    command: "upgrade",
    ask: [
      {
        question: "Database URL",
        hint: "To back up and migrate it. Blank to use DATABASE_URL, or skip if unset",
        flag: "--db-url",
      },
    ],
  },
  {
    group: "Upkeep",
    label: "Repair the database",
    command: "db",
    args: ["repair"],
    ask: [
      {
        question: "Database URL",
        hint: "Blank to use DATABASE_URL",
        flag: "--db-url",
      },
    ],
  },
  {
    group: "Upkeep",
    label: "Back up",
    command: "backup",
    ask: [
      {
        question: "Database URL",
        hint: "To include its data. Blank to use DATABASE_URL, or files only if unset",
        flag: "--db-url",
      },
    ],
  },
  { group: "Upkeep", label: "Restart the app", command: "restart" },
  {
    group: "Upkeep",
    label: "Rebuild and restart the app",
    command: "restart",
    args: ["--build"],
  },
  {
    group: "Upkeep",
    label: "Stop the app",
    command: "stop",
    confirm: "Stop the app? People can't reach it until it's started again.",
  },
];

export interface MenuIo {
  prompter: Prompter;
  prefix: string;
  run: (argv: string[]) => Promise<CliResult>;
  show: (result: CliResult, command?: string) => void;
}

export async function argvFor(entry: Entry, prompter: Pick<Prompter, "text">): Promise<string[]> {
  const argv = [entry.command, ...(entry.args ?? [])];
  for (const item of entry.ask ?? []) {
    const answer = await prompter.text({
      message: item.question,
      hint: item.hint,
      optional: !item.required,
    });
    if (!answer) continue;
    if (item.flag) argv.push(item.flag, answer);
    else if (item.positional) argv.push(answer);
  }
  return argv;
}

const QUIT = "quit";
const HELP = "help";

export async function runMenu(io: MenuIo): Promise<void> {
  const { prompter } = io;
  const options: Choice<string>[] = [
    ...MENU.map((entry, index) => ({
      value: String(index),
      label: entry.label,
      hint: [io.prefix, entry.command, ...(entry.args ?? []), ...(entry.ask ? ["..."] : [])]
        .filter(Boolean)
        .join(" "),
      group: entry.group,
    })),
    {
      value: HELP,
      label: "Every command",
      hint: [io.prefix, "help"].filter(Boolean).join(" "),
      group: "More",
    },
    { value: QUIT, label: "Quit", group: "More" },
  ];
  prompter.say(intro("bogey"));
  let last: string | undefined;
  for (;;) {
    let choice: string;
    try {
      choice = await prompter.select({
        message: "What do you want to do?",
        options,
        initial: last,
      });
    } catch (error) {
      if (error instanceof Cancelled) return;
      throw error;
    }
    if (choice === QUIT) return;
    last = choice;
    try {
      const entry = MENU[Number(choice)];
      if (choice === HELP || !entry) {
        io.show(await io.run([HELP]));
      } else {
        if (entry.confirm && !(await prompter.confirm({ message: entry.confirm }))) continue;
        io.show(await io.run(await argvFor(entry, prompter)), entry.command);
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) throw error;
      continue;
    }
    // Ask before redrawing the menu, which would push the output off screen.
    try {
      if (!(await prompter.confirm({ message: "Back to the main menu?", initial: false }))) return;
    } catch (error) {
      if (error instanceof Cancelled) return;
      throw error;
    }
  }
}
