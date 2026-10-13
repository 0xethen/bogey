import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey console [--port <number>]

Starts the operator console from a checkout: a page for this machine only (127.0.0.1) that shows
doctor, migration and queue status, tails container logs, and runs this CLI's operator commands
(database, plugins, orgs, events, restart and upgrade). Its Local link carries a one-time token;
open it in a browser on this machine. Stop it with Ctrl+C.
The console is never part of the public image or the web app.`;

export function runConsole(cwd: string, args: string[]): CliResult | Promise<CliResult> {
  const flags = parseFlags(args);
  const port = typeof flags.port === "string" ? Number(flags.port) : 3737;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { exitCode: 1, output: "--port takes a number from 1024 to 65535." };
  }
  const root = findRepoRoot(cwd);
  const app = join(root, "apps", "console");
  if (!existsSync(app)) {
    return {
      exitCode: 1,
      output:
        "The console runs from a checkout of Bogey (apps/console); this install doesn't have one.",
    };
  }
  const token = randomBytes(24).toString("hex");
  return new Promise((resolve) => {
    const child = spawn(
      "vp",
      ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      {
        cwd: app,
        stdio: "inherit",
        env: { ...process.env, CONSOLE_TOKEN: token, CONSOLE_PORT: String(port), BOGEY_ROOT: root },
      },
    );
    child.on("error", () =>
      resolve({
        exitCode: 1,
        output: "Couldn't run `vp`. Install Vite+ (see docs/getting-started.md).",
      }),
    );
    child.on("exit", (code) => resolve({ exitCode: code ?? 0, output: "" }));
  });
}
