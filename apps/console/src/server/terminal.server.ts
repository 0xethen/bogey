import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { readEnv } from "bogey-cli/src/lib/credentials.ts";
import { TERMINAL_FLAG } from "#/lib/terminal-flag.ts";
import { cliInvocation } from "#/server/process.server.ts";

export { TERMINAL_FLAG };

function root(): string {
  return process.env.BOGEY_ROOT ?? process.cwd();
}

export function terminalEnabled(): boolean {
  const value = process.env[TERMINAL_FLAG] ?? readEnv(join(root(), ".env"))[TERMINAL_FLAG] ?? "";
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

export function splitLine(line: string): { args: string[] } | { error: string } {
  const args: string[] = [];
  let word: string | null = null;
  let quote: '"' | "'" | null = null;
  for (let at = 0; at < line.length; at++) {
    const char = line[at] ?? "";
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && at + 1 < line.length) word += line[++at] ?? "";
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      word ??= "";
    } else if (char === "\\" && at + 1 < line.length) {
      word = (word ?? "") + (line[++at] ?? "");
    } else if (/\s/.test(char)) {
      if (word !== null) args.push(word);
      word = null;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (quote) return { error: `Close the ${quote} quote.` };
  if (word !== null) args.push(word);
  if (args[0] === "bogey") args.shift();
  return { args };
}

function quote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * script(1) gives the CLI a real terminal (so its prompts work) without a native dependency.
 * macOS's script refuses a socket for stdin, which is what Node's pipes are, so bash hands it
 * a real pipe from a relay. The relay is Node, not `cat`: under `vp run`, Vite+ swaps `cat` for
 * a uutils build that holds input back until a newline, so arrow keys and Ctrl+C never arrived.
 */
function ptyInvocation(command: Tuple<string>, cols: number, rows: number) {
  const size = [String(cols), String(rows)];
  if (process.platform === "darwin") {
    const sized = 'stty cols "$1" rows "$2" 2>/dev/null; shift 2; exec "$@"';
    const relay = `${quote(process.execPath)} -e ${quote("process.stdin.pipe(process.stdout)")}`;
    const piped = `exec script -q /dev/null /bin/sh -c "$0" sh "$@" < <(exec ${relay})`;
    return { program: "/bin/bash", args: ["-c", piped, sized, ...size, ...command] };
  }
  const sized = `stty cols ${size[0]} rows ${size[1]} 2>/dev/null; exec ${command.map(quote).join(" ")}`;
  return { program: "script", args: ["-q", "-f", "-e", "-c", sized, "/dev/null"] };
}

const sessions = new Map<string, ChildProcessWithoutNullStreams>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value) || min, min), max);
}

export function startTerminal(
  args: Tuple<string>,
  size: { cols: number; rows: number },
): { id: string; stream: ReadableStream<Uint8Array> } {
  const encoder = new TextEncoder();
  const id = randomUUID();
  const cli = cliInvocation(args);
  const { program, args: ptyArgs } = ptyInvocation(
    [cli.program, ...cli.args],
    clamp(size.cols, 20, 400),
    clamp(size.rows, 5, 200),
  );
  // An empty BOGEY_COMMAND makes the CLI name commands bare (`doctor`), as they're typed here.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: "xterm-256color",
    FORCE_COLOR: "1",
    BOGEY_COMMAND: "",
  };
  delete env.BOGEY_NO_INPUT;
  delete env.NO_COLOR;
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const push = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const finish = (text: string) => {
        push(text);
        if (open) controller.close();
        open = false;
        sessions.delete(id);
      };
      const child = spawn(program, ptyArgs, { cwd: cli.cwd, stdio: "pipe", env });
      sessions.set(id, child);
      stop = () => {
        open = false;
        sessions.delete(id);
        if (child.exitCode === null) child.kill("SIGTERM");
      };
      // A chunk can end inside a multi-byte character (the menu's box drawing); decode statefully.
      const decoder = new StringDecoder("utf8");
      child.stdout.on("data", (chunk: Buffer) => push(decoder.write(chunk)));
      child.stderr.on("data", (chunk: Buffer) => push(decoder.write(chunk)));
      child.on("error", (error) =>
        finish(`Couldn't start a terminal (${program}): ${error.message}\r\n`),
      );
      let exitCode: number | null = null;
      child.on("exit", (code) => {
        exitCode = code;
        sessions.delete(id);
        child.stdin.end();
      });
      child.on("close", (code) => finish(`\u0000${exitCode ?? code ?? "?"}`));
    },
    cancel() {
      stop();
    },
  });
  return { id, stream };
}

export function writeTerminal(id: string, data: string): boolean {
  const child = sessions.get(id);
  if (!child || child.exitCode !== null || child.stdin.writableEnded) return false;
  child.stdin.write(data);
  return true;
}
