import { styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];

export function colorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  tty: boolean = !!process.stdout.isTTY,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  return tty && env.TERM !== "dumb";
}

let enabled = colorEnabled();

export function setColor(on: boolean): void {
  enabled = on;
}

export function paint(format: Format, text: string): string {
  return enabled ? styleText(format, text, { validateStream: false }) : text;
}

export const bold = (text: string) => paint("bold", text);
export const dim = (text: string) => paint("dim", text);
export const accent = (text: string) => paint("cyan", text);
export const good = (text: string) => paint("green", text);
export const warn = (text: string) => paint("yellow", text);
export const bad = (text: string) => paint("red", text);

export const brand = (text: string) => paint(["bold", "bgMagenta", "white"], text);

export function visibleLength(text: string): number {
  // oxlint-disable-next-line no-control-regex -- matching escape codes is the point
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}
