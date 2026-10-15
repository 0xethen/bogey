import { SEMVER, SLUG } from "@bogey/utils/keys";

type Flag = `--${string}`;

interface BaseParam {
  name: string;
  label: string;
  description?: string;
  flag?: Flag;
  optional?: boolean;
}

export interface TextParam extends BaseParam {
  kind: "text";
  pattern: RegExp;
  placeholder: string;
}

export interface PluginParam extends BaseParam {
  kind: "plugin";
}

export interface ChoiceParam extends BaseParam {
  kind: "choice";
  options: Tuple<{ value: string; label: string }>;
}

export interface SwitchParam {
  kind: "switch";
  name: string;
  label: string;
  description?: string;
  flag: Flag;
}

export type CommandParam = TextParam | PluginParam | ChoiceParam | SwitchParam;

export type CommandGroup = "status" | "database" | "plugins" | "people" | "events" | "host";

export const GROUPS: Tuple<{ id: CommandGroup; label: string; description: string }> = [
  {
    id: "status",
    label: "Status",
    description: "Read-only checks. The first few run when the page opens.",
  },
  {
    id: "database",
    label: "Database",
    description: "Migrations, schema repair and backups.",
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Install, switch on or off, migrate and remove plugins.",
  },
  {
    id: "people",
    label: "Orgs & accounts",
    description: "Organizations, their hostnames, sign-in codes and admin MFA.",
  },
  { id: "events", label: "Events", description: "Export an event to a folder, or restore one." },
  {
    id: "host",
    label: "App & host",
    description: "Restart, stop or upgrade the app, and read container logs.",
  },
];

export interface ConsoleCommand {
  id: string;
  group: CommandGroup;
  label: string;
  description: string;
  kind: "read" | "change";
  cli: Tuple<string>;
  params?: Tuple<CommandParam>;
  autorun?: boolean;
  twoStep?: { preview: Tuple<string>; apply: Tuple<string>; applyLabel: string };
}

const EMAIL = /^[^\s@-][^\s@]*@[^\s@]+\.[^\s@]+$/;
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NAME = /^[^-\s][^\n\r]{0,99}$/;
const FOLDER = /^(?!-)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./ -]{1,200}$/;
const URL_PATTERN = /^https?:\/\/[^\s]{1,200}$/;
const GITHUB_REPO = /^github:[\w.-]+\/[\w.-]+$/;
const PLUGIN_SPEC =
  /^(?:[a-z][a-z0-9-]{1,30}[a-z0-9](?:@[\w.+-]+)?|github:[\w.-]+\/[\w.-]+\/[a-z][a-z0-9-]{1,30}[a-z0-9]@[\w.+-]+)$/;
const WORDS = /^[^-\n\r][^\n\r]{0,79}$/;
const TAG = new RegExp(`^v?${SEMVER.source.slice(1, -1)}$`);
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const INTEGER = /^-?\d{1,4}$/;

const orgSlug = (optional = false, flag: Flag | undefined = "--org"): TextParam => ({
  kind: "text",
  name: "org",
  label: "Org slug",
  flag,
  optional,
  pattern: SLUG,
  placeholder: "acme",
});
const owner: TextParam = {
  kind: "text",
  name: "owner",
  label: "Owner email",
  flag: "--owner",
  pattern: EMAIL,
  placeholder: "you@acme.org",
};
const orgName: TextParam = {
  kind: "text",
  name: "name",
  label: "Org name",
  flag: "--name",
  pattern: NAME,
  placeholder: "Acme Hack Club",
};
const host = (optional: boolean, flag?: Flag): TextParam => ({
  kind: "text",
  name: "host",
  label: "Hostname",
  flag,
  optional,
  pattern: HOSTNAME,
  placeholder: "hacks.acme.org",
});
const plugin = (optional = false): PluginParam => ({
  kind: "plugin",
  name: "key",
  label: "Plugin",
  optional,
});
const outFolder = (placeholder: string, optional = true): TextParam => ({
  kind: "text",
  name: "out",
  label: "Folder",
  flag: "--out",
  optional,
  pattern: FOLDER,
  placeholder,
});

export const COMMANDS: Tuple<ConsoleCommand> = [
  {
    id: "doctor",
    group: "status",
    label: "Check this install",
    description: "bogey doctor: config, the sign-up hook, .env safety, plugins and migrations.",
    kind: "read",
    cli: ["doctor"],
    autorun: true,
    params: [
      {
        kind: "switch",
        name: "remote",
        label: "Also check the Supabase project",
        description:
          "Sign-ups, the schema, the app address and the Send Email hook, through its API.",
        flag: "--remote",
      },
    ],
  },
  {
    id: "db-status",
    group: "status",
    label: "Database migrations",
    description: "bogey db status: which migrations the database has and which the app expects.",
    kind: "read",
    cli: ["db", "status"],
    autorun: true,
  },
  {
    id: "plugins-status",
    group: "status",
    label: "Plugin migrations",
    description: "bogey plugins status: which migrations each plugin has applied.",
    kind: "read",
    cli: ["plugins", "status"],
    autorun: true,
  },
  {
    id: "queues",
    group: "status",
    label: "Mail and webhook queues",
    description: "bogey queues: what is waiting to be sent and the last failure.",
    kind: "read",
    cli: ["queues"],
    autorun: true,
  },
  {
    id: "plugins-list",
    group: "status",
    label: "Installed plugins",
    description: "bogey plugins list: every plugin on disk and whether it's disabled.",
    kind: "read",
    cli: ["plugins", "list"],
  },
  {
    id: "plugins-outdated",
    group: "status",
    label: "Plugin updates",
    description: "bogey plugins outdated: asks each plugin's repository for a newer version.",
    kind: "read",
    cli: ["plugins", "outdated"],
  },
  {
    id: "mfa-status",
    group: "status",
    label: "Admin MFA",
    description: "bogey mfa status: whether instance admins need an authenticator app.",
    kind: "read",
    cli: ["mfa", "status"],
  },
  {
    id: "config-check",
    group: "status",
    label: "Instance config",
    description:
      "bogey config check: whether bogey.config.ts is valid and the database has the keys only it sets.",
    kind: "read",
    cli: ["config", "check"],
  },
  {
    id: "org-list",
    group: "status",
    label: "Organizations",
    description: "bogey org list: every org and its hostnames.",
    kind: "read",
    cli: ["org", "list"],
  },

  {
    id: "db-migrate",
    group: "database",
    label: "Apply migrations",
    description:
      "bogey db migrate: applies the migrations the database is missing, then the bundled plugins'.",
    kind: "change",
    cli: ["db", "migrate"],
  },
  {
    id: "db-repair",
    group: "database",
    label: "Repair the schema",
    description:
      "bogey db repair: brings an older database in line with supabase/schemas. Never drops a table, column or row.",
    kind: "change",
    cli: ["db", "repair"],
    twoStep: { preview: ["--dry-run"], apply: ["--yes"], applyLabel: "Repair" },
  },
  {
    id: "backup",
    group: "database",
    label: "Back up",
    description:
      "bogey backup: copies Storage files, and the data when a database URL is set. Defaults to backups/<timestamp>.",
    kind: "change",
    cli: ["backup"],
    params: [outFolder("backups/before-upgrade")],
  },
  {
    id: "plugins-migrate",
    group: "plugins",
    label: "Apply plugin migrations",
    description:
      "bogey plugins migrate: applies each plugin's missing migrations, or one plugin's.",
    kind: "change",
    cli: ["plugins", "migrate"],
    params: [plugin(true)],
  },
  {
    id: "plugins-info",
    group: "plugins",
    label: "Plugin details",
    description: "bogey plugins info: version, author and where it's published.",
    kind: "read",
    cli: ["plugins", "info"],
    params: [plugin()],
  },
  {
    id: "plugins-enable",
    group: "plugins",
    label: "Enable a plugin",
    description:
      "bogey plugins enable: takes it off plugins.disabled in bogey.config.ts. Restart after.",
    kind: "change",
    cli: ["plugins", "enable"],
    params: [plugin()],
  },
  {
    id: "plugins-disable",
    group: "plugins",
    label: "Disable a plugin",
    description: "bogey plugins disable: keeps it installed but switches it off. Restart after.",
    kind: "change",
    cli: ["plugins", "disable"],
    params: [plugin()],
  },
  {
    id: "plugins-search",
    group: "plugins",
    label: "Search libraries",
    description: "bogey plugins search: finds plugins in the libraries this instance searches.",
    kind: "read",
    cli: ["plugins", "search"],
    params: [
      {
        kind: "text",
        name: "words",
        label: "Words",
        optional: true,
        pattern: WORDS,
        placeholder: "leaderboard",
      },
    ],
  },
  {
    id: "plugins-add",
    group: "plugins",
    label: "Install a plugin",
    description:
      "bogey plugins add: shows what the plugin is and its SQL, then installs it. Rebuild the app after (restart --build).",
    kind: "change",
    cli: ["plugins", "add"],
    params: [
      {
        kind: "text",
        name: "spec",
        label: "Plugin",
        description:
          "<key>[@<version>] from a library, or github:<owner>/<repo>/<plugin>@<version>.",
        pattern: PLUGIN_SPEC,
        placeholder: "leaderboard@1.2.0",
      },
      {
        kind: "switch",
        name: "require-attestation",
        label: "Require a GitHub attestation",
        flag: "--require-attestation",
      },
      {
        kind: "switch",
        name: "force",
        label: "Replace one that's already installed",
        flag: "--force",
      },
    ],
    twoStep: { preview: [], apply: ["--yes"], applyLabel: "Install" },
  },
  {
    id: "plugins-install",
    group: "plugins",
    label: "Restore from the lockfile",
    description: "bogey plugins install: puts back exactly the plugins in bogey.plugins.lock.",
    kind: "change",
    cli: ["plugins", "install"],
  },
  {
    id: "plugins-remove",
    group: "plugins",
    label: "Uninstall a plugin",
    description:
      "bogey plugins remove: drops everything its migrations made, its rows in Bogey's tables and its files.",
    kind: "change",
    cli: ["plugins", "remove"],
    params: [plugin()],
    twoStep: { preview: ["--dry-run"], apply: ["--yes"], applyLabel: "Uninstall" },
  },
  {
    id: "plugins-library-list",
    group: "plugins",
    label: "Libraries",
    description: "bogey plugins library: the official library, then bogey.libraries.json's.",
    kind: "read",
    cli: ["plugins", "library", "list"],
  },
  {
    id: "plugins-library-add",
    group: "plugins",
    label: "Add a library",
    description: "bogey plugins library add: searches another repository's index.json too.",
    kind: "change",
    cli: ["plugins", "library", "add"],
    params: [
      {
        kind: "text",
        name: "repo",
        label: "Repository",
        pattern: GITHUB_REPO,
        placeholder: "github:you/bogeyx",
      },
    ],
  },
  {
    id: "plugins-library-remove",
    group: "plugins",
    label: "Remove a library",
    description: "bogey plugins library remove: stops searching a repository.",
    kind: "change",
    cli: ["plugins", "library", "remove"],
    params: [
      {
        kind: "text",
        name: "repo",
        label: "Repository",
        pattern: GITHUB_REPO,
        placeholder: "github:you/bogeyx",
      },
    ],
  },
  {
    id: "plugins-sql",
    group: "plugins",
    label: "Plugin SQL",
    description:
      "bogey plugins sql: prints migrations and seed.sql for psql (every enabled plugin by default).",
    kind: "read",
    cli: ["plugins", "sql"],
    params: [plugin(true)],
  },

  {
    id: "org-init",
    group: "people",
    label: "Set up the first org",
    description:
      "bogey org init: the first org, its owner (made a platform admin) and hostname. Safe to run again.",
    kind: "change",
    cli: ["org", "init"],
    params: [
      orgSlug(),
      orgName,
      owner,
      host(true, "--host"),
      {
        kind: "text",
        name: "app-url",
        label: "App address",
        description: "Where the database calls to send Bogey's own email.",
        flag: "--app-url",
        optional: true,
        pattern: URL_PATTERN,
        placeholder: "http://web:3000",
      },
      { kind: "switch", name: "demo", label: "Seed the demo hackathon too", flag: "--demo" },
    ],
  },
  {
    id: "org-create",
    group: "people",
    label: "Create an org",
    description:
      "bogey org create: makes the owner (created if needed) its owner, not a platform admin.",
    kind: "change",
    cli: ["org", "create"],
    params: [orgSlug(), orgName, owner, host(true, "--host")],
  },
  {
    id: "org-domain-add",
    group: "people",
    label: "Add a hostname",
    description: "bogey org domain add: maps a hostname to an org, counted as verified.",
    kind: "change",
    cli: ["org", "domain", "add"],
    params: [orgSlug(false, undefined), host(false)],
  },
  {
    id: "org-domain-remove",
    group: "people",
    label: "Remove a hostname",
    description: "bogey org domain remove: unmaps a hostname.",
    kind: "change",
    cli: ["org", "domain", "remove"],
    params: [host(false)],
  },
  {
    id: "login",
    group: "people",
    label: "Sign-in code",
    description: "bogey login: prints a sign-in code for an account, without sending email.",
    kind: "read",
    cli: ["login"],
    params: [
      { kind: "text", name: "email", label: "Email", pattern: EMAIL, placeholder: "you@acme.org" },
      {
        kind: "text",
        name: "app",
        label: "Where the link opens",
        flag: "--app",
        optional: true,
        pattern: URL_PATTERN,
        placeholder: "http://localhost:3000",
      },
      {
        kind: "switch",
        name: "create",
        label: "Create the account if there isn't one",
        flag: "--create",
      },
    ],
  },
  {
    id: "mfa-on",
    group: "people",
    label: "Require admin MFA",
    description: "bogey mfa on: instance admins need an authenticator app (the default).",
    kind: "change",
    cli: ["mfa", "on"],
  },
  {
    id: "mfa-off",
    group: "people",
    label: "Stop requiring admin MFA",
    description:
      "bogey mfa off: lets locked-out admins back in with email sign-in alone. Turn it back on after.",
    kind: "change",
    cli: ["mfa", "off"],
  },
  {
    id: "seed-demo",
    group: "people",
    label: "Seed the demo",
    description:
      "bogey seed demo: (re)creates the demo hackathon and each enabled plugin's demo in an org.",
    kind: "change",
    cli: ["seed", "demo"],
    params: [orgSlug(true)],
  },

  {
    id: "event-export",
    group: "events",
    label: "Export an event",
    description: "bogey event export: writes an event's tables and files to a folder.",
    kind: "read",
    cli: ["event", "export"],
    params: [
      {
        kind: "text",
        name: "event",
        label: "Event",
        description: "<org slug>/<event slug>",
        pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
        placeholder: "acme/spring-hack",
      },
      outFolder("exports/spring-hack", false),
    ],
  },
  {
    id: "event-import",
    group: "events",
    label: "Import an event",
    description:
      "bogey event import: makes a new draft event from an export folder. Every id is new.",
    kind: "change",
    cli: ["event", "import"],
    params: [
      {
        kind: "text",
        name: "folder",
        label: "Export folder",
        pattern: FOLDER,
        placeholder: "exports/spring-hack",
      },
      orgSlug(true),
      {
        kind: "text",
        name: "slug",
        label: "New slug",
        flag: "--slug",
        optional: true,
        pattern: SLUG,
        placeholder: "fall-hack",
      },
      {
        kind: "text",
        name: "name",
        label: "New name",
        flag: "--name",
        optional: true,
        pattern: NAME,
        placeholder: "Fall Hack",
      },
      {
        kind: "text",
        name: "starts-at",
        label: "New start",
        flag: "--starts-at",
        optional: true,
        pattern: DATE,
        placeholder: "2026-11-01",
      },
      {
        kind: "text",
        name: "shift-days",
        label: "Or shift dates by days",
        flag: "--shift-days",
        optional: true,
        pattern: INTEGER,
        placeholder: "180",
      },
      {
        kind: "switch",
        name: "people",
        label: "Restore people too",
        description: "Members, teams, registrations, submissions, scores and check-ins.",
        flag: "--people",
      },
    ],
  },

  {
    id: "config-apply",
    group: "host",
    label: "Apply the instance config",
    description:
      "bogey config apply: writes appUrl, network and security.requireAdminMfa from bogey.config.ts to the database, without a restart.",
    kind: "change",
    cli: ["config", "apply"],
  },
  {
    id: "restart",
    group: "host",
    label: "Restart the app",
    description:
      "bogey restart: restarts deploy/compose.yml. Rebuild to pick up a theme or an installed plugin.",
    kind: "change",
    cli: ["restart"],
    params: [
      {
        kind: "choice",
        name: "service",
        label: "Service",
        optional: true,
        options: [
          { value: "web", label: "web" },
          { value: "caddy", label: "caddy" },
        ],
      },
      { kind: "switch", name: "build", label: "Rebuild the image first", flag: "--build" },
    ],
  },
  {
    id: "stop",
    group: "host",
    label: "Stop the app",
    description:
      "bogey stop: stops the app's containers. Supabase runs separately and isn't touched.",
    kind: "change",
    cli: ["stop"],
    params: [
      {
        kind: "switch",
        name: "down",
        label: "Remove the containers too",
        description: "Volumes, and so Caddy's certificates, are kept.",
        flag: "--down",
      },
    ],
  },
  {
    id: "upgrade",
    group: "host",
    label: "Upgrade Bogey",
    description:
      "bogey upgrade: backs up, merges upstream, installs, migrates, regenerates and runs doctor.",
    kind: "change",
    cli: ["upgrade"],
    params: [
      {
        kind: "text",
        name: "to",
        label: "Release tag",
        description: "The latest release when empty.",
        flag: "--to",
        optional: true,
        pattern: TAG,
        placeholder: "v2.1.0",
      },
      { kind: "switch", name: "pre", label: "Allow prereleases", flag: "--pre" },
      {
        kind: "switch",
        name: "require-verified",
        label: "Refuse an unattested release",
        flag: "--require-verified",
      },
      { kind: "switch", name: "skip-backup", label: "Skip the backup", flag: "--skip-backup" },
    ],
    twoStep: { preview: ["--dry-run"], apply: [], applyLabel: "Upgrade" },
  },
];

export const NOT_IN_CONSOLE: Readonly<Record<string, string>> = {
  console: "it is the console",
  docs: "authors the repo's reference docs",
  email: "regenerates the repo's email templates",
  release: "cuts a Bogey release from a development checkout",
  reset: "deletes every row; too much for a button, type it at a terminal",
  setup: "asks for secrets one by one at a terminal",
  themes: "regenerates the repo's theme list",
  types: "regenerates the repo's Database types",
  watch: "runs for as long as you develop",
  "db baseline": "authors the schema baseline",
  "db freeze": "authors the schema baseline",
  "db migration": "authors a migration",
  "db mark-applied": "rare repair for a hand-built database; easy to get wrong",
  "db url": "local supabase start stacks only",
  "db studio": "opens a browser on the machine running it",
  "plugins new": "scaffolds plugin source",
  "plugins link": "points installed/ at a plugin checkout for development",
  "plugins schema": "prints JSON Schemas for library authors",
};

export function findCommand(id: unknown): ConsoleCommand | undefined {
  return COMMANDS.find((command) => command.id === id);
}

export type ParamValues = Readonly<Record<string, string | boolean>>;

export function paramProblem(
  param: CommandParam,
  value: string | boolean | undefined,
  plugins: Tuple<string>,
): string | null {
  if (param.kind === "switch") {
    return value === undefined || typeof value === "boolean" ? null : `${param.label}: on or off.`;
  }
  if (value === undefined || value === "")
    return param.optional ? null : `${param.label} is needed.`;
  if (typeof value !== "string") return `${param.label} takes text.`;
  if (param.kind === "plugin")
    return plugins.includes(value) ? null : `${param.label}: no plugin "${value}" here.`;
  if (param.kind === "choice")
    return param.options.some((option) => option.value === value)
      ? null
      : `${param.label}: pick one of the choices.`;
  return param.pattern.test(value)
    ? null
    : `${param.label}: doesn't look like ${param.placeholder}.`;
}

export function commandArgs(
  command: ConsoleCommand,
  values: ParamValues,
  plugins: Tuple<string>,
  step: "preview" | "apply" = "apply",
): { args: string[] } | { problems: string[] } {
  const params = command.params ?? [];
  const problems = params
    .map((param) => paramProblem(param, values[param.name], plugins))
    .filter((problem) => problem !== null);
  if (problems.length) return { problems };
  const positional: string[] = [];
  const flags: string[] = [];
  for (const param of params) {
    const value = values[param.name];
    if (param.kind === "switch") {
      if (value === true) flags.push(param.flag);
    } else if (typeof value === "string" && value !== "") {
      if (param.flag) flags.push(param.flag, value);
      else positional.push(value);
    }
  }
  const extra = command.twoStep ? command.twoStep[step] : [];
  return { args: [...command.cli, ...positional, ...flags, ...extra] };
}

export const LOG_SERVICES = [
  "web",
  "caddy",
  "auth",
  "db",
  "kong",
  "realtime",
  "storage",
  "rest",
  "migrate",
] as const;

export type LogService = (typeof LOG_SERVICES)[number];

export function isLogService(value: unknown): value is LogService {
  return LOG_SERVICES.some((service) => service === value);
}
