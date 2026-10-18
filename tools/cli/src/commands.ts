import { runBackup, USAGE as backup } from "./commands/backup.ts";
import { runConfig, USAGE as configUsage } from "./commands/config.ts";
import { runConsole, USAGE as consoleUsage } from "./commands/console.ts";
import { runDb, USAGE as db } from "./commands/db.ts";
import { runUpgrade, USAGE as upgrade } from "./commands/upgrade.ts";
import { runSetup, USAGE as setup } from "./commands/setup.ts";
import { runDocs, USAGE as docs } from "./commands/docs.ts";
import { runDoctor, runDoctorRemote, USAGE as doctor } from "./commands/doctor.ts";
import { runEmail, USAGE as email } from "./commands/email.ts";
import { runEvent, USAGE as event } from "./commands/event.ts";
import { runLogin, USAGE as login } from "./commands/login.ts";
import { runMfa, USAGE as mfa } from "./commands/mfa.ts";
import { runOrg, USAGE as org } from "./commands/org.ts";
import {
  installedPlugins,
  runPlugins,
  SUBCOMMANDS as pluginSubcommands,
  USAGE as plugins,
} from "./commands/plugins.ts";
import { runPreflight, USAGE as preflight } from "./commands/preflight.ts";
import { runQueues, USAGE as queues } from "./commands/queues.ts";
import { runRelease, USAGE as release } from "./commands/release.ts";
import { runRepair, USAGE as repair } from "./commands/repair.ts";
import { askWith, runReset, USAGE as reset } from "./commands/reset.ts";
import { runSeed, USAGE as seed } from "./commands/seed.ts";
import { runRestart, runStop, RESTART_USAGE, STOP_USAGE } from "./commands/stack.ts";
import { runThemes, USAGE as themes } from "./commands/themes.ts";
import { runTypes, USAGE as types } from "./commands/types.ts";
import { runWatch, USAGE as watch } from "./commands/watch.ts";
import type { CliResult } from "./cli.ts";
import type { Choice, Prompter } from "./lib/prompt.ts";

export interface Command {
  name: string;
  summary: string;
  usage: string;
  subcommands?: Tuple<string>;
  run: (cwd: string, args: string[], prompter: Prompter | null) => CliResult | Promise<CliResult>;
}

export const COMMANDS: Tuple<Command> = [
  {
    name: "backup",
    summary: "Copy Storage files, and with a database URL its data, to a folder",
    usage: backup,
    run: runBackup,
  },
  {
    name: "config",
    summary: "Check bogey.config.ts, and write the keys only it sets to the database",
    usage: configUsage,
    subcommands: ["check", "apply"],
    run: (cwd, args) => runConfig(cwd, args),
  },
  {
    name: "console",
    summary: "Start the operator console on this machine (127.0.0.1 only)",
    usage: consoleUsage,
    run: runConsole,
  },
  {
    name: "db",
    summary: "The schema baseline and migrations: freeze, add, status, migrate, repair",
    usage: `${db}\n\n${repair}`,
    subcommands: [
      "baseline",
      "freeze",
      "migration",
      "status",
      "migrate",
      "mark-applied",
      "repair",
      "url",
      "studio",
    ],
    run: async (cwd, args, prompter) => {
      const chosen =
        args.length || !prompter
          ? args
          : await pick(prompter, "Database", [
              { value: "status", label: "Which migrations it has applied" },
              { value: "migrate", label: "Apply pending migrations" },
              { value: "repair", label: "Bring an older database in line with supabase/schemas" },
              { value: "baseline", label: "Rebuild the baseline from supabase/schemas" },
              { value: "url", label: "Print the local Supabase URLs" },
              { value: "studio", label: "Open Supabase Studio" },
            ]);
      return chosen[0] === "repair"
        ? runRepair(cwd, chosen.slice(1), undefined, prompter)
        : runDb(cwd, chosen);
    },
  },
  {
    name: "docs",
    summary: "Regenerate the settings and CLI references, or build the wiki",
    usage: docs,
    subcommands: ["wiki"],
    run: runDocs,
  },
  {
    name: "doctor",
    summary: "Check the sign-up hook, .env safety and plugin configuration",
    usage: doctor,
    run: (cwd, args) => (args.includes("--remote") ? runDoctorRemote(cwd) : runDoctor(cwd)),
  },
  {
    name: "email",
    summary: "Regenerate the fallback email templates GoTrue uses without the hook",
    usage: email,
    subcommands: ["templates"],
    run: runEmail,
  },
  {
    name: "event",
    summary: "List, publish, delete, export or restore events",
    usage: event,
    subcommands: ["list", "visibility", "delete", "export", "import"],
    run: (cwd, args, prompter) => runEvent(cwd, args, prompter),
  },
  {
    name: "login",
    summary: "Print a sign-in code for an account, without sending email",
    usage: login,
    run: runLogin,
  },
  {
    name: "mfa",
    summary: "Turn the authenticator-app requirement for instance admins on or off",
    usage: mfa,
    subcommands: ["status", "on", "off"],
    run: (cwd, args, prompter) => runMfa(cwd, args, prompter),
  },
  {
    name: "org",
    summary: "Set up the first organization, create others, and manage their hostnames",
    usage: org,
    subcommands: ["list", "init", "create", "domain"],
    run: (cwd, args, prompter) => runOrg(cwd, args, prompter),
  },
  {
    name: "plugins",
    summary: "List, inspect, enable, disable or scaffold plugins",
    usage: plugins,
    subcommands: pluginSubcommands,
    run: async (cwd, args, prompter) => {
      if (!prompter) return runPlugins(cwd, args);
      const [action, ...rest] = args;
      const needsKey = action === "enable" || action === "disable" || action === "info";
      const keys = installedPlugins(cwd);
      if (needsKey && !rest.some((arg) => !arg.startsWith("--")) && keys.length) {
        const key = await prompter.select({
          message: `Which plugin? (${action})`,
          options: keys.map((value) => ({ value, label: value })),
        });
        return runPlugins(cwd, [action, key, ...rest]);
      }
      return runPlugins(cwd, args, undefined, {
        confirm: (question) => prompter.confirm({ message: question }),
        say: prompter.say,
      });
    },
  },
  {
    name: "preflight",
    summary: "Check the instance can take an event of N people, and what to raise if not",
    usage: preflight,
    run: (cwd, args) => runPreflight(cwd, args),
  },
  {
    name: "restart",
    summary: "Restart the app from deploy/compose.yml, or rebuild it with --build",
    usage: RESTART_USAGE,
    run: (cwd, args) => runRestart(cwd, args),
  },
  {
    name: "stop",
    summary: "Stop the app's containers",
    usage: STOP_USAGE,
    run: (cwd, args) => runStop(cwd, args),
  },
  {
    name: "queues",
    summary: "Show waiting mail and webhook deliveries",
    usage: queues,
    run: runQueues,
  },
  {
    name: "release",
    summary: "Cut a Bogey release: bump the version, stamp the changelog, tag and push",
    usage: release,
    subcommands: ["check"],
    run: (cwd, args, prompter) => runRelease(cwd, args, prompter),
  },
  {
    name: "reset",
    summary: "Factory-reset a database: dump it, confirm, then re-apply the baseline",
    usage: reset,
    run: (cwd, args, prompter) => runReset(cwd, args, undefined, askWith(prompter)),
  },
  {
    name: "seed",
    summary: "Create the demo hackathon and contest in an org",
    usage: seed,
    subcommands: ["demo"],
    run: runSeed,
  },
  {
    name: "themes",
    summary: "Regenerate the theme list from packages/ui/src/styles/themes",
    usage: themes,
    run: runThemes,
  },
  {
    name: "types",
    summary: "Regenerate packages/db's Database types (core schema only)",
    usage: types,
    run: (cwd, args) => runTypes(cwd, args),
  },
  {
    name: "watch",
    summary: "Keep generated files up to date while developing",
    usage: watch,
    run: runWatch,
  },
  {
    name: "setup",
    summary:
      "Write .env from .env.example, then apply the schema and create the first organization",
    usage: setup,
    run: (cwd, args, prompter) => runSetup(cwd, args, prompter),
  },
  {
    name: "upgrade",
    summary: "Back up, merge upstream, install, migrate and check, in one go",
    usage: upgrade,
    run: (cwd, args) => runUpgrade(cwd, args),
  },
];

async function pick(
  prompter: Prompter,
  message: string,
  options: Tuple<Choice<string>>,
): Promise<string[]> {
  return [await prompter.select({ message, options })];
}
