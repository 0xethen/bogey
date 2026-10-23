import type { Command } from "../commands.ts";

export function imageHome(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.BOGEY_HOME || null;
}

export const WHERE: Readonly<Record<string, string>> = {
  backup: "checkout, container",
  config: "checkout, container",
  console: "checkout",
  db: "checkout; container: `status`, `migrate`, `mark-applied`, `repair`",
  docs: "checkout",
  doctor: "checkout, container",
  email: "checkout, container",
  event: "checkout, container",
  login: "checkout, container",
  mfa: "checkout, container",
  org: "checkout, container",
  plugins: "checkout; container: `list`, `info`, `outdated`, `status`, `migrate`, `sql`",
  preflight: "checkout, container",
  queues: "checkout, container",
  restart: "checkout, host",
  stop: "checkout, host",
  release: "checkout",
  reset: "checkout, container",
  runner: "checkout, container",
  seed: "checkout, container",
  themes: "checkout",
  types: "checkout",
  watch: "checkout",
  setup: "checkout; container: `--all-in-one` only",
  upgrade: "checkout",
};

const AUTHORING = (what: string) =>
  `${what} needs a checkout of Bogey's source. This image carries only what running an instance needs; ` +
  "see docs/reference/cli.md for where each command works.";

export function imageNote(command: Pick<Command, "name">, args: Tuple<string>): string | null {
  const sub = args[0] ?? "";
  switch (command.name) {
    case "upgrade":
      return [
        "bogey upgrade updates a checkout. In a container, move to a newer release by pulling its image:",
        "  1. change the image tag (or BOGEY_VERSION in an instance repository's Dockerfile)",
        "  2. docker compose pull && docker compose up -d",
        "  3. docker compose exec web bogey db migrate && docker compose exec web bogey plugins migrate",
        "docs/self-hosting/upgrading.md has the details.",
      ].join("\n");
    case "restart":
    case "stop":
      return `bogey ${command.name} runs docker compose, so run it on the host: docker compose ${command.name === "stop" ? "stop" : "restart web"}. A container can't control its own host, on purpose.`;
    case "docs":
    case "themes":
    case "types":
    case "watch":
    case "release":
      return AUTHORING(`bogey ${command.name}`);
    case "setup":
      return args.includes("--all-in-one")
        ? null
        : 'bogey setup writes the .env the container reads, so run it where that file lives. For the all-in-one compose: docker run --rm -v "$PWD:/out" <image> bogey setup --all-in-one --out /out --host <host>. See docs/self-hosting/all-in-one.md.';
    case "db":
      return ["status", "migrate", "mark-applied", "repair"].includes(sub)
        ? null
        : AUTHORING(`bogey db ${sub || "<subcommand>"}`);
    case "plugins":
      return ["", "list", "info", "outdated", "status", "migrate", "sql"].includes(sub)
        ? null
        : `bogey plugins ${sub} changes what's installed or switched off, which is part of the image. Do it in your instance repository (bogey.config.ts, bogey.plugins.lock) and rebuild.`;
    default:
      return null;
  }
}
