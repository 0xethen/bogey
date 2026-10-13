import { useEffect, useRef, type RefObject } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const PROMPT = "\u001b[2m$\u001b[0m ";
const PROMPT_WIDTH = 2;
const dim = (text: string) => `\u001b[2m${text}\u001b[0m`;
const red = (text: string) => `\u001b[31m${text}\u001b[0m`;
// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\[[0-9;?]*[A-Za-z~]|\u001b[O[]?[A-Za-z]?/g;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f]/g;

function rgb(color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return "#e5e5e5";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 229, g = 229, b = 229] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Line editing while nothing runs; once a command starts, every key goes to its terminal. */
class Shell {
  private line = "";
  private pos = 0;
  private history: string[] = [];
  private back = 0;
  private session: { id: string | null; controller: AbortController } | null = null;
  private pending = "";
  private sending = false;

  constructor(
    private readonly term: Xterm,
    private readonly onBusy: (busy: boolean) => void,
  ) {}

  hello() {
    this.term.writeln(
      `${dim("Type a")} bogey ${dim("command, like")} bogey doctor${dim(", or just")} bogey ${dim("for the menu.")}`,
    );
    this.term.write(`${dim("Prompts work here; Ctrl+C stops a command.")}\r\n\r\n${PROMPT}`);
  }

  dispose() {
    this.session?.controller.abort();
  }

  input(data: string) {
    if (this.session) {
      this.send(data);
      return;
    }
    if (data === "\r") return this.submit();
    if (data === "\u007f" || data === "\b") {
      if (this.pos > 0) this.edit(this.line.slice(0, this.pos - 1) + this.line.slice(this.pos), -1);
      return;
    }
    if (data === "\u001b[3~") {
      if (this.pos < this.line.length) {
        this.edit(this.line.slice(0, this.pos) + this.line.slice(this.pos + 1), 0);
      }
      return;
    }
    if (data === "\u001b[D" || data === "\u001bOD") return this.moveTo(this.pos - 1);
    if (data === "\u001b[C" || data === "\u001bOC") return this.moveTo(this.pos + 1);
    if (["\u001b[H", "\u001bOH", "\u001b[1~", "\u0001"].includes(data)) return this.moveTo(0);
    if (["\u001b[F", "\u001bOF", "\u001b[4~", "\u0005"].includes(data)) {
      return this.moveTo(this.line.length);
    }
    if (data === "\u0015") return this.edit(this.line.slice(this.pos), -this.pos);
    if (data === "\u000b") return this.edit(this.line.slice(0, this.pos), 0);
    if (data === "\u0003") {
      this.moveTo(this.line.length);
      this.term.write(`^C\r\n${PROMPT}`);
      this.line = "";
      this.pos = 0;
      return;
    }
    if (data === "\u000c") return this.term.clear();
    if (data === "\u001b[A" || data === "\u001b[B") {
      const step = data === "\u001b[A" ? 1 : -1;
      this.back = Math.min(Math.max(this.back + step, 0), this.history.length);
      this.replace(this.back === 0 ? "" : (this.history.at(-this.back) ?? ""));
      return;
    }
    const [typed = "", ...rest] = data.split("\r");
    const text = typed.replace(ESCAPES, "").replace(CONTROLS, "");
    if (text)
      this.edit(this.line.slice(0, this.pos) + text + this.line.slice(this.pos), text.length);
    if (rest.length > 0) this.submit();
  }

  /** Moves the cursor to a click, if it landed on the line being edited. */
  click(col: number, row: number) {
    if (this.session) return;
    const { cursorY } = this.term.buffer.active;
    const cols = this.term.cols;
    const start = cursorY - Math.floor((PROMPT_WIDTH + this.pos) / cols);
    this.moveTo((row - start) * cols + col - PROMPT_WIDTH);
  }

  private moveTo(pos: number) {
    this.edit(this.line, Math.min(Math.max(pos, 0), this.line.length) - this.pos);
  }

  /** Replaces the line and moves the cursor by `shift`, redrawing what the line spans. */
  private edit(line: string, shift: number) {
    const cols = this.term.cols;
    const up = Math.floor((PROMPT_WIDTH + this.pos) / cols);
    this.line = line;
    this.pos = Math.min(Math.max(this.pos + shift, 0), line.length);
    const end = PROMPT_WIDTH + line.length;
    const target = PROMPT_WIDTH + this.pos;
    // A line ending exactly at the edge leaves the cursor pending a wrap; settle it on the next row.
    const settle = end % cols === 0 ? " \b" : "";
    const back = Math.floor(end / cols) - Math.floor(target / cols);
    this.term.write(
      `${up > 0 ? `\u001b[${up}A` : ""}\r\u001b[J${PROMPT}${line}${settle}` +
        `${back > 0 ? `\u001b[${back}A` : ""}\u001b[${(target % cols) + 1}G`,
    );
  }

  private replace(line: string) {
    this.edit(line, line.length - this.pos);
  }

  private submit() {
    const line = this.line.trim();
    this.moveTo(this.line.length);
    this.line = "";
    this.pos = 0;
    this.back = 0;
    this.term.write("\r\n");
    if (!line) return this.term.write(PROMPT);
    if (this.history.at(-1) !== line) this.history.push(line);
    // could create problems if we ever make a bogey clear/cls
    if (line === "clear" || line === "cls") {
      this.term.clear();
      return this.term.write(PROMPT);
    }
    // could create problems if we ever make a bogey echo (but its fun)
    if (line.startsWith("echo ")) {
      this.term.write(`${line.slice(5)}\r\n${PROMPT}`);
      return;
    }
    void this.run(line);
  }

  private async run(line: string) {
    const controller = new AbortController();
    const session: { id: string | null; controller: AbortController } = { id: null, controller };
    this.session = session;
    this.onBusy(true);
    let exit: string | null = null;
    try {
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line, cols: this.term.cols, rows: this.term.rows }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        this.term.write(red((await response.text()).replaceAll("\n", "\r\n")));
        return;
      }
      session.id = response.headers.get("X-Terminal-Session");
      void this.flush();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (exit !== null) {
          exit += text;
          continue;
        }
        const end = text.indexOf("\u0000");
        this.term.write(end === -1 ? text : text.slice(0, end));
        if (end !== -1) exit = text.slice(end + 1);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.term.write(red(`\r\nThe console lost the command: ${message}`));
      }
    } finally {
      if (this.session === session) this.session = null;
      this.onBusy(this.session !== null);
      this.pending = "";
      if (this.term.buffer.active.cursorX > 0) this.term.write("\r\n");
      if (exit && exit !== "0") this.term.write(`${red(`[exit ${exit}]`)}\r\n`);
      this.term.write(PROMPT);
    }
  }

  private send(data: string) {
    this.pending += data;
    void this.flush();
  }

  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending && this.session?.id) {
        const data = this.pending;
        this.pending = "";
        await fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: this.session.id, data }),
        }).catch(() => undefined);
      }
    } finally {
      this.sending = false;
    }
  }
}

export function Terminal({
  active,
  clearRef,
  onBusyChange,
}: {
  active: boolean;
  clearRef: RefObject<(() => void) | null>;
  onBusyChange: (busy: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const loaded = useRef<{ term: Xterm; fit: FitAddon } | null>(null);
  const shown = useRef(active);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const [{ Terminal: XtermTerminal }, { FitAddon: Fit }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;
      const style = getComputedStyle(element);
      const foreground = rgb(style.color);
      const term = new XtermTerminal({
        allowTransparency: true,
        cursorBlink: true,
        fontFamily: style.fontFamily,
        fontSize: 12,
        lineHeight: 1.4,
        scrollback: 5000,
        theme: {
          background: "rgba(0, 0, 0, 0)",
          foreground,
          cursor: foreground,
          selectionBackground: "rgba(255, 255, 255, 0.2)",
        },
      });
      const fit = new Fit();
      term.loadAddon(fit);
      term.open(element);
      const refit = () => {
        if (element.offsetWidth > 0 && element.offsetHeight > 0) fit.fit();
      };
      refit();
      const shell = new Shell(term, onBusyChange);
      const typing = term.onData((data) => shell.input(data));
      const clicked = (event: MouseEvent) => {
        const screen = element.querySelector(".xterm-screen");
        if (!screen || term.hasSelection()) return;
        const box = screen.getBoundingClientRect();
        shell.click(
          Math.floor(((event.clientX - box.left) / box.width) * term.cols),
          Math.floor(((event.clientY - box.top) / box.height) * term.rows),
        );
      };
      element.addEventListener("click", clicked);
      shell.hello();
      clearRef.current = () => {
        term.clear();
        term.focus();
      };
      const observer = new ResizeObserver(refit);
      observer.observe(element);
      loaded.current = { term, fit };
      if (shown.current) term.focus();
      cleanup = () => {
        observer.disconnect();
        element.removeEventListener("click", clicked);
        typing.dispose();
        shell.dispose();
        term.dispose();
        loaded.current = null;
        clearRef.current = null;
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [clearRef, onBusyChange]);

  useEffect(() => {
    shown.current = active;
    if (!active) return;
    const current = loaded.current;
    if (!current) return;
    current.fit.fit();
    current.term.focus();
  }, [active]);

  return (
    <div className="min-h-0 flex-1 px-4 pt-3 pb-2">
      <div ref={host} className="h-full font-mono text-fg" />
    </div>
  );
}
