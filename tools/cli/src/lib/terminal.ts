import { openSync } from "node:fs";
import { ReadStream, WriteStream } from "node:tty";

let controlling: ReadStream | null | undefined;
let screen: WriteStream | null | undefined;

export function inputDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.BOGEY_NO_INPUT;
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

export function terminalInput(): ReadStream | null {
  if (inputDisabled()) return null;
  if (process.stdin.isTTY) return process.stdin;
  if (controlling) {
    controlling.ref();
    return controlling;
  }
  if (controlling === null) return null;
  try {
    controlling = new ReadStream(openSync("/dev/tty", "r"));
  } catch {
    controlling = null;
  }
  return controlling;
}

export function releaseTerminal(): void {
  controlling?.pause();
  controlling?.unref();
}

export function terminalOutput(): WriteStream | null {
  if (inputDisabled()) return null;
  if (process.stdout.isTTY) return process.stdout;
  if (screen !== undefined) return screen;
  try {
    screen = new WriteStream(openSync("/dev/tty", "w"));
  } catch {
    screen = null;
  }
  return screen;
}
