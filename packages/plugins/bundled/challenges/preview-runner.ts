import type { EditorLanguage } from "@bogey/ui/components/code-editor";

const PREVIEWABLE: Tuple<EditorLanguage> = ["javascript", "python"];

export function isPreviewSupported(language: EditorLanguage): boolean {
  return PREVIEWABLE.includes(language);
}

export type PreviewResult =
  | { status: "ok"; stdout: string; stderr: string; exitCode: number; ms: number }
  | { status: "timeout" }
  | { status: "stopped" }
  | { status: "error"; message: string };

interface RunRequest {
  id: string;
  language: EditorLanguage;
  source: string;
  stdin: string;
}

type WorkerReply =
  | { id: string; kind: "started" }
  | { id: string; kind: "done"; stdout: string; stderr: string; exitCode: number; ms: number }
  | { id: string; kind: "failed"; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<RunRequest>) => void) | null;
  postMessage(message: WorkerReply): void;
  importScripts(url: string): void;
  loadPyodide?: (options: { indexURL: string }) => Promise<Pyodide>;
}

interface Pyodide {
  globals: { set(name: string, value: unknown): void };
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options: { write: (bytes: Uint8Array) => number }): void;
  setStderr(options: { write: (bytes: Uint8Array) => number }): void;
}

function workerMain(scope: WorkerScope): void {
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.28.0/full/";
  const CAP = 256 * 1024;
  let pyodide: Promise<Pyodide> | null = null;

  const capped = (text: string) =>
    text.length > CAP ? `${text.slice(0, CAP)}\n[output cut off at 256 KB]` : text;

  function loadPython(): Promise<Pyodide> {
    if (!pyodide) {
      scope.importScripts(`${PYODIDE}pyodide.js`);
      const load = scope.loadPyodide;
      if (!load) throw new Error("Python didn't load.");
      pyodide = load({ indexURL: PYODIDE });
    }
    return pyodide;
  }

  async function runPython(python: Pyodide, source: string, stdin: string) {
    let stdout = "";
    let stderr = "";
    const decoder = new TextDecoder();
    python.setStdout({
      write: (bytes) => {
        if (stdout.length <= CAP) stdout += decoder.decode(bytes);
        return bytes.length;
      },
    });
    python.setStderr({
      write: (bytes) => {
        if (stderr.length <= CAP) stderr += decoder.decode(bytes);
        return bytes.length;
      },
    });
    python.globals.set("__bogey_stdin", stdin);
    python.globals.set("__bogey_source", source);
    let exitCode = 0;
    try {
      // a fresh namespace each run, so names from an earlier version of the code don't linger
      await python.runPythonAsync(
        [
          "import sys, io, linecache",
          "sys.stdin = io.StringIO(__bogey_stdin)",
          'linecache.cache["<main>"] = (len(__bogey_source), None, __bogey_source.splitlines(True), "<main>")',
          'exec(compile(__bogey_source, "<main>", "exec"), {"__name__": "__main__"})',
        ].join("\n"),
      );
    } catch (error) {
      exitCode = 1;
      stderr += error instanceof Error ? error.message : String(error);
    }
    return { stdout, stderr, exitCode };
  }

  async function runJavaScript(source: string, stdin: string) {
    let stdout = "";
    let stderr = "";
    const show = (value: unknown) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const write = (text: string, to: "out" | "err") => {
      if (to === "out" && stdout.length <= CAP) stdout += text;
      if (to === "err" && stderr.length <= CAP) stderr += text;
    };
    const line = (args: unknown[], to: "out" | "err") => write(`${args.map(show).join(" ")}\n`, to);
    const lines = stdin.split("\n");
    if (lines.at(-1) === "") lines.pop();
    let cursor = 0;

    const onLine: Array<(text: string) => void> = [];
    const onClose: Array<() => void> = [];
    const readlineModule = {
      createInterface: () => {
        const rl = {
          on: (event: string, listener: (text: string) => void) => {
            if (event === "line") onLine.push(listener);
            if (event === "close") onClose.push(() => listener(""));
            return rl;
          },
          close: () => undefined,
        };
        return rl;
      },
    };
    const fs = {
      readFileSync: (file: number | string) => {
        if (file === 0 || file === "/dev/stdin") return stdin;
        throw new Error("Only stdin can be read here.");
      },
    };
    class Exit {
      constructor(readonly code: number) {}
    }
    const host = {
      console: {
        log: (...args: unknown[]) => line(args, "out"),
        info: (...args: unknown[]) => line(args, "out"),
        error: (...args: unknown[]) => line(args, "err"),
        warn: (...args: unknown[]) => line(args, "err"),
      },
      require: (name: string) => {
        if (name === "fs") return fs;
        if (name === "readline") return readlineModule;
        throw new Error(`Cannot require "${name}" here.`);
      },
      process: {
        argv: [],
        env: {},
        stdin: { fd: 0 },
        stdout: { write: (text: string) => write(text, "out") },
        stderr: { write: (text: string) => write(text, "err") },
        exit: (code = 0) => {
          throw new Exit(code);
        },
      },
      readline: () => (cursor < lines.length ? (lines[cursor++] ?? null) : null),
    };

    let exitCode = 0;
    try {
      const run: unknown = new Function(
        "console",
        "require",
        "process",
        "readline",
        `return (async () => {\n${source}\n})();`,
      );
      if (typeof run === "function") {
        await run(host.console, host.require, host.process, host.readline);
      }
      for (const text of lines) for (const listener of onLine) listener(text);
      for (const listener of onClose) listener();
    } catch (error) {
      if (error instanceof Exit) exitCode = error.code;
      else {
        exitCode = 1;
        stderr += error instanceof Error ? (error.stack ?? error.message) : String(error);
      }
    }
    return { stdout, stderr, exitCode };
  }

  scope.onmessage = async (event) => {
    const { id, language, source, stdin } = event.data;
    try {
      if (language !== "python" && language !== "javascript") {
        throw new Error("This language can't run in the browser.");
      }
      const python = language === "python" ? await loadPython() : null;
      scope.postMessage({ id, kind: "started" });
      const started = performance.now();
      const result = python
        ? await runPython(python, source, stdin)
        : await runJavaScript(source, stdin);
      scope.postMessage({
        id,
        kind: "done",
        stdout: capped(result.stdout),
        stderr: capped(result.stderr),
        exitCode: result.exitCode,
        ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      scope.postMessage({
        id,
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src blob:",
  "connect-src https://cdn.jsdelivr.net",
].join("; ");

function frameSource(): string {
  const worker = `(${workerMain.toString()})(self);`;
  const relay = `
    const url = URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: "text/javascript" }));
    const worker = new Worker(url);
    addEventListener("message", (event) => { if (event.source === parent) worker.postMessage(event.data); });
    worker.onmessage = (event) => parent.postMessage(event.data, "*");
    worker.onerror = (event) => parent.postMessage({ id: null, kind: "failed", message: event.message }, "*");
    parent.postMessage({ kind: "ready" }, "*");
  `;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${relay.replace(/<\//g, "<\\/")}</script>`;
}

interface Frame {
  element: HTMLIFrameElement;
  ready: Promise<void>;
}

let frame: Frame | null = null;

function isKind(data: unknown): data is { kind: string; id?: string | null } {
  return typeof data === "object" && data !== null && "kind" in data;
}

function sandbox(): Frame {
  if (frame) return frame;
  const element = document.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts");
  element.setAttribute("aria-hidden", "true");
  element.tabIndex = -1;
  element.style.display = "none";
  const ready = new Promise<void>((resolve) => {
    const onReady = (event: MessageEvent) => {
      if (event.source !== element.contentWindow) return;
      if (isKind(event.data) && event.data.kind === "ready") {
        window.removeEventListener("message", onReady);
        resolve();
      }
    };
    window.addEventListener("message", onReady);
  });
  element.srcdoc = frameSource();
  document.body.append(element);
  frame = { element, ready };
  return frame;
}

function discard(): void {
  frame?.element.remove();
  frame = null;
}

function replyTo(data: unknown, id: string): WorkerReply | null {
  if (!isKind(data) || (data.id !== id && data.id !== null)) return null;
  if (data.kind === "started") return { id, kind: "started" };
  if (
    data.kind === "done" &&
    "stdout" in data &&
    typeof data.stdout === "string" &&
    "stderr" in data &&
    typeof data.stderr === "string" &&
    "exitCode" in data &&
    typeof data.exitCode === "number" &&
    "ms" in data &&
    typeof data.ms === "number"
  ) {
    return {
      id,
      kind: "done",
      stdout: data.stdout,
      stderr: data.stderr,
      exitCode: data.exitCode,
      ms: data.ms,
    };
  }
  if (data.kind === "failed") {
    const message = "message" in data && typeof data.message === "string" ? data.message : "";
    return { id, kind: "failed", message: message || "The run failed." };
  }
  return null;
}

export async function runClientPreview(
  language: EditorLanguage,
  source: string,
  stdin: string,
  limitMs = 8_000,
  signal?: AbortSignal,
): Promise<PreviewResult> {
  if (!isPreviewSupported(language)) {
    return { status: "error", message: "This language can't run in the browser." };
  }
  if (signal?.aborted) return { status: "stopped" };
  const { element, ready } = sandbox();
  await ready;
  if (signal?.aborted) return { status: "stopped" };
  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: PreviewResult) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      discard();
      finish({ status: "stopped" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      discard();
      finish({ status: "error", message: "The language took too long to load." });
    }, 90_000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== element.contentWindow) return;
      const reply = replyTo(event.data, id);
      if (!reply) return;
      if (reply.kind === "started") {
        clearTimeout(timer);
        timer = setTimeout(() => {
          discard();
          finish({ status: "timeout" });
        }, limitMs);
      } else if (reply.kind === "done") {
        const { stdout, stderr, exitCode, ms } = reply;
        finish({ status: "ok", stdout, stderr, exitCode, ms });
      } else {
        finish({ status: "error", message: reply.message });
      }
    };
    window.addEventListener("message", onMessage);
    const request: RunRequest = { id, language, source, stdin };
    element.contentWindow?.postMessage(request, "*");
  });
}

// the frames that belong to the participant's code, without the runner's own
export function userTrace(stderr: string, language: EditorLanguage): string {
  if (language === "python") {
    const lines = stderr.split("\n");
    const start = lines.findIndex((line) => line.startsWith("Traceback (most recent call last):"));
    if (start === -1) return stderr;
    const kept = lines.slice(0, start + 1);
    let mine = false;
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("  File ")) mine = line.includes('"<main>"');
      else if (!line.startsWith("    ") && !line.startsWith("  ")) mine = true;
      if (mine) kept.push(line);
    }
    return kept.join("\n");
  }
  if (language === "javascript") {
    const lines = stderr.split("\n");
    const first = lines.findIndex((line) => /^\s+at /.test(line));
    if (first === -1) return stderr;
    const frames = lines.slice(first).flatMap((line) => {
      const at = /<anonymous>:(\d+):(\d+)/.exec(line);
      // new Function adds two lines and the async wrapper a third
      return at ? [`    at line ${Number(at[1]) - 3}, column ${at[2]}`] : [];
    });
    return [...lines.slice(0, first), ...frames].join("\n");
  }
  return stderr;
}

export function sameOutput(actual: string, expected: string): boolean {
  const lines = (text: string) =>
    text
      .replace(/\r\n/g, "\n")
      .trimEnd()
      .split("\n")
      .map((line) => line.trimEnd());
  const a = lines(actual);
  const b = lines(expected);
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
