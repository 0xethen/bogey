import { emitKeypressEvents } from "node:readline";
import { accent, bad, bold, brand, dim, good, paint, visibleLength, warn } from "./style.ts";
import { releaseTerminal, terminalInput, terminalOutput } from "./terminal.ts";

export class Cancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "Cancelled";
  }
}

export interface TextQuestion {
  message: string;
  initial?: string;
  placeholder?: string;
  hint?: string;
  secret?: boolean;
  optional?: boolean;
  validate?: (value: string) => string | null;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
  group?: string;
}

export interface SelectQuestion<T extends string> {
  message: string;
  options: Tuple<Choice<T>>;
  initial?: T;
}

export interface ConfirmQuestion {
  message: string;
  initial?: boolean;
}

export interface Prompter {
  text: (question: TextQuestion) => Promise<string>;
  select: <T extends string>(question: SelectQuestion<T>) => Promise<T>;
  confirm: (question: ConfirmQuestion) => Promise<boolean>;
  say: (text: string) => void;
}

export function settle(question: TextQuestion, raw: string): { value: string } | { error: string } {
  const value = raw.trim() || question.initial || "";
  if (!value && !question.optional) return { error: "Required." };
  const problem = value ? question.validate?.(value) : null;
  return problem ? { error: problem } : { value };
}

const BAR = dim("│");
const symbol = {
  active: accent("◆"),
  done: good("◇"),
  cancelled: bad("■"),
} as const;

type State = keyof typeof symbol;

interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

type Outcome<R> = { result: R } | undefined;

function interact<R>(
  draw: (state: State) => string,
  handle: (input: string | undefined, key: Key) => Outcome<R>,
): Promise<R> {
  const input = terminalInput();
  const output = terminalOutput();
  if (!input || !output) return Promise.reject(new Error("No terminal to ask on."));
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write("\u001b[?25l");

  let rows = 0;
  const render = (state: State) => {
    const columns = output.columns || 80;
    const text = draw(state);
    if (rows > 1) output.write(`\u001b[${rows - 1}A`);
    output.write("\r\u001b[0J");
    output.write(text);
    rows = text
      .split("\n")
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(visibleLength(line) / columns)), 0);
  };

  return new Promise<R>((resolve, reject) => {
    const finish = (state: State) => {
      render(state);
      output.write("\n\u001b[?25h");
      input.off("keypress", onKey);
      input.setRawMode(false);
      input.pause();
      releaseTerminal();
    };
    const onKey = (typed: string | undefined, key: Key | undefined) => {
      const pressed = key ?? {};
      if ((pressed.ctrl && pressed.name === "c") || pressed.name === "escape") {
        finish("cancelled");
        reject(new Cancelled());
        return;
      }
      const outcome = handle(typed, pressed);
      if (outcome) {
        finish("done");
        resolve(outcome.result);
        return;
      }
      render("active");
    };
    input.on("keypress", onKey);
    render("active");
  });
}

function header(state: State, message: string): string {
  return `${BAR}\n${symbol[state]}  ${state === "active" ? bold(message) : message}`;
}

function ask(question: TextQuestion): Promise<string> {
  let value = "";
  let error: string | null = null;
  const shown = (text: string) => (question.secret ? "•".repeat(text.length) : text);

  return interact(
    (state) => {
      const lines = [header(state, question.message)];
      if (state === "done") {
        const answer = settle(question, value);
        const text = "value" in answer ? shown(answer.value) : "";
        lines.push(`${BAR}  ${dim(text || "(none)")}`);
      } else if (state === "cancelled") {
        lines.push(`${BAR}  ${dim(paint("strikethrough", shown(value)))}`);
      } else {
        const placeholder = question.placeholder ?? question.initial;
        const field = value
          ? `${shown(value)}${paint("inverse", " ")}`
          : placeholder
            ? `${paint("inverse", placeholder[0] ?? " ")}${dim(placeholder.slice(1))}`
            : paint("inverse", " ");
        lines.push(`${BAR}  ${field}`);
        for (const line of question.hint?.split("\n") ?? []) lines.push(`${BAR}  ${dim(line)}`);
        lines.push(error ? `${warn("└")}  ${warn(error)}` : dim("└"));
      }
      return lines.join("\n");
    },
    (typed, key) => {
      if (key.name === "return" || key.name === "enter") {
        const answer = settle(question, value);
        if ("value" in answer) return { result: answer.value };
        error = answer.error;
        return undefined;
      }
      error = null;
      if (key.name === "backspace") value = value.slice(0, -1);
      else if (key.ctrl && key.name === "u") value = "";
      else if (key.name === "tab" && !value && question.initial) value = question.initial;
      else if (typed && !key.ctrl && !key.meta && typed >= " ") value += typed;
      return undefined;
    },
  );
}

/** Where Shift+Up/Down lands: the first option of the previous/next group, wrapping around. */
export function groupJump(
  options: Tuple<{ group?: string }>,
  index: number,
  direction: "up" | "down",
): number {
  const starts = options.flatMap((option, at) =>
    at === 0 || option.group !== options[at - 1]?.group ? [at] : [],
  );
  if (starts.length === 0) return index;
  if (direction === "down") return starts.find((start) => start > index) ?? starts[0] ?? index;
  return starts.findLast((start) => start < index) ?? starts.at(-1) ?? index;
}

function choose<T extends string>(question: SelectQuestion<T>): Promise<T> {
  const options = question.options;
  let index = Math.max(
    0,
    options.findIndex((option) => option.value === question.initial),
  );

  return interact(
    (state) => {
      const lines = [header(state, question.message)];
      const picked = options[index];
      if (state !== "active") {
        const label = picked?.label ?? "";
        lines.push(`${BAR}  ${dim(state === "cancelled" ? paint("strikethrough", label) : label)}`);
        return lines.join("\n");
      }
      const groups = new Set(options.map((option) => option.group).filter(Boolean)).size;
      const height = Math.max(5, (terminalOutput()?.rows || 24) - 5 - groups * 2);
      const start = Math.min(
        Math.max(0, index - Math.floor(height / 2)),
        Math.max(0, options.length - height),
      );
      const end = Math.min(options.length, start + height);
      if (start > 0) lines.push(`${BAR}  ${dim("↑ more")}`);
      for (let at = start; at < end; at++) {
        const option = options[at];
        if (!option) continue;
        if (option.group && option.group !== options[at - 1]?.group) {
          if (at > start) lines.push(BAR);
          lines.push(`${BAR}  ${dim(option.group)}`);
        }
        const current = at === index;
        const mark = current ? accent("●") : dim("○");
        const label = current ? bold(option.label) : option.label;
        const hint = option.hint && current ? `  ${dim(option.hint)}` : "";
        lines.push(`${BAR}  ${mark} ${label}${hint}`);
      }
      if (end < options.length) lines.push(`${BAR}  ${dim("↓ more")}`);
      lines.push(dim("└  ↑/↓ to move, Shift+↑/↓ to jump a group, Enter to pick, Esc to quit"));
      return lines.join("\n");
    },
    (typed, key) => {
      if ((key.name === "up" || key.name === "down") && key.shift)
        index = groupJump(options, index, key.name);
      else if (key.name === "up" || typed === "k")
        index = (index - 1 + options.length) % options.length;
      else if (key.name === "down" || typed === "j") index = (index + 1) % options.length;
      else if (key.name === "return" || key.name === "enter") {
        const picked = options[index];
        if (picked) return { result: picked.value };
      }
      return undefined;
    },
  );
}

function yesNo(question: ConfirmQuestion): Promise<boolean> {
  let yes = question.initial ?? false;
  return interact(
    (state) => {
      const lines = [header(state, question.message)];
      if (state !== "active") {
        lines.push(`${BAR}  ${dim(yes ? "Yes" : "No")}`);
      } else {
        const option = (on: boolean, label: string) =>
          on ? `${accent("●")} ${bold(label)}` : `${dim("○")} ${dim(label)}`;
        lines.push(`${BAR}  ${option(yes, "Yes")} ${dim("/")} ${option(!yes, "No")}`);
        lines.push(dim("└"));
      }
      return lines.join("\n");
    },
    (typed, key) => {
      if (key.name === "return" || key.name === "enter") return { result: yes };
      if (typed === "y" || typed === "Y") return { result: true };
      if (typed === "n" || typed === "N") return { result: false };
      if (["left", "right", "up", "down", "tab", "h", "l"].includes(key.name ?? "")) yes = !yes;
      return undefined;
    },
  );
}

export function terminalPrompter(): Prompter | null {
  const output = terminalOutput();
  if (!terminalInput() || !output) {
    releaseTerminal();
    return null;
  }
  releaseTerminal();
  return {
    text: ask,
    select: choose,
    confirm: yesNo,
    say: (text) => output.write(`${text}\n`),
  };
}

export function intro(title: string): string {
  return `${dim("┌")}  ${brand(` ${title} `)}`;
}
