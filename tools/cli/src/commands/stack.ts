import { existsSync } from "node:fs";
import { step } from "../lib/activity.ts";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import { spawnRunner, type ProcessResult, type Runner } from "../lib/migrations.ts";
import type { CliResult } from "../cli.ts";

export const RESTART_USAGE = `bogey restart [--build] [service...]

Restarts the app (and Caddy, if you name it) from deploy/compose.yml. With --build it
rebuilds the image first: a theme or an installed plugin is part of the build, so only a
rebuild picks it up. A change to bogey.config.ts (brand, repository, updates, security,
plugins.disabled) only needs the restart, since the app reads it when it starts. Settings
and email templates need neither; they apply as soon as they're saved.

The web app can't do this itself, on purpose: restarting a container needs control of
the host, which a public web app must never have.`;

export const STOP_USAGE = `bogey stop [--down]

Stops the containers in deploy/compose.yml. --down also removes them (volumes, and so
Caddy's certificates, are kept). Supabase runs separately and isn't touched.`;

function compose(cwd: string): { root: string; file: string } | string {
  const root = findRepoRoot(cwd);
  const file = join(root, "deploy", "compose.yml");
  return existsSync(file) ? { root, file } : `No deploy/compose.yml at ${root}.`;
}

function outcome(result: ProcessResult, done: string): CliResult {
  const text = [result.stdout, result.stderr]
    .filter((part) => part.trim())
    .join("\n")
    .trim();
  if (result.status === 0)
    return { exitCode: 0, output: text ? `${text}\n✓ ${done}` : `✓ ${done}` };
  if (result.status === null) {
    return { exitCode: 1, output: `Couldn't run docker: ${text || "is it installed?"}` };
  }
  return {
    exitCode: 1,
    output: `docker compose failed (exit ${result.status}).${text ? `\n${text}` : ""}`,
  };
}

export function runRestart(cwd: string, args: string[], run: Runner = spawnRunner): CliResult {
  const found = compose(cwd);
  if (typeof found === "string") return { exitCode: 1, output: found };
  const build = args.includes("--build");
  const unknown = args.find((arg) => arg.startsWith("--") && arg !== "--build");
  if (unknown)
    return { exitCode: 1, output: `bogey restart: unknown flag ${unknown}\n\n${RESTART_USAGE}` };
  const services = args.filter((arg) => !arg.startsWith("--"));
  const targets = services.length ? services : ["web"];
  const base = ["compose", "-f", found.file];
  const result = build
    ? step(`Rebuild and start ${targets.join(", ")}`, () =>
        run("docker", [...base, "up", "-d", "--build", ...targets]),
      )
    : step(`Restart ${targets.join(", ")}`, () => run("docker", [...base, "restart", ...targets]));
  return outcome(
    result,
    build ? `Rebuilt and started ${targets.join(", ")}.` : `Restarted ${targets.join(", ")}.`,
  );
}

export function runStop(cwd: string, args: string[], run: Runner = spawnRunner): CliResult {
  const found = compose(cwd);
  if (typeof found === "string") return { exitCode: 1, output: found };
  const unknown = args.find((arg) => arg !== "--down");
  if (unknown)
    return { exitCode: 1, output: `bogey stop: unknown argument ${unknown}\n\n${STOP_USAGE}` };
  const down = args.includes("--down");
  const result = step(down ? "Stop and remove the containers" : "Stop the containers", () =>
    run("docker", ["compose", "-f", found.file, down ? "down" : "stop"]),
  );
  return outcome(result, down ? "Stopped and removed the containers." : "Stopped.");
}
