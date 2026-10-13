import { spawn } from "node:child_process";
import { join } from "node:path";
import { pluginKeysOnDisk } from "bogey-cli/src/lib/plugin-dirs.ts";
import type { LogService } from "#/server/commands.ts";

function root(): string {
  return process.env.BOGEY_ROOT ?? process.cwd();
}

export function pluginKeys(): string[] {
  return pluginKeysOnDisk(root());
}

export function cliInvocation(args: Tuple<string>) {
  return {
    program: process.execPath,
    args: [join(root(), "tools", "cli", "src", "bin.ts"), ...args],
    cwd: root(),
  };
}

export function logInvocation(service: LogService, lines: number) {
  const tail = String(Math.min(Math.max(Math.trunc(lines), 10), 1000));
  return {
    program: "docker",
    args: [
      "compose",
      "-f",
      join(root(), "deploy", "compose.yml"),
      "logs",
      "--no-color",
      "--tail",
      tail,
      service,
    ],
    cwd: root(),
  };
}

export function streamProcess(
  program: string,
  args: Tuple<string>,
  cwd: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const push = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const finish = (text: string) => {
        push(text);
        if (open) controller.close();
        open = false;
      };
      const child = spawn(program, [...args], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", BOGEY_NO_INPUT: "1" },
      });
      stop = () => {
        open = false;
        if (child.exitCode === null) child.kill("SIGTERM");
      };
      child.stdout.on("data", (chunk: Buffer) => push(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => push(chunk.toString()));
      child.on("error", (error) => finish(`Couldn't start ${program}: ${error.message}\n`));
      child.on("close", (code) => finish(`\n[exit ${code ?? "?"}]\n`));
    },
    cancel() {
      stop();
    },
  });
}
