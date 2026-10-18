import { spawn, spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { Prompter } from "./prompt.ts";

export const ISSUES_URL = "https://github.com/0xethen/bogey/issues";

export function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true }).unref();
}

const CLIPBOARDS: Tuple<[string, string[]]> =
  process.platform === "darwin"
    ? [["pbcopy", []]]
    : process.platform === "win32"
      ? [["clip", []]]
      : [
          ["wl-copy", []],
          ["xclip", ["-selection", "clipboard"]],
          ["xsel", ["--clipboard", "--input"]],
        ];

export function copyToClipboard(text: string): boolean {
  return CLIPBOARDS.some(
    ([command, args]) => spawnSync(command, args, { input: text, stdio: "pipe" }).status === 0,
  );
}

export interface ReportTools {
  copy: (text: string) => boolean;
  open: (url: string) => void;
}

// after a failure: copy the error (yes by default), then open the issues page (no by default)
export async function offerReport(
  prompter: Prompter,
  error: string,
  tools: ReportTools = { copy: copyToClipboard, open: openInBrowser },
): Promise<void> {
  if (await prompter.confirm({ message: "Copy the error?", initial: true })) {
    prompter.say(
      tools.copy(stripVTControlCharacters(error))
        ? "Copied."
        : "Couldn't copy it: no clipboard command (pbcopy, clip, wl-copy, xclip or xsel) worked.",
    );
  }
  if (await prompter.confirm({ message: `Open ${ISSUES_URL}?`, initial: false })) {
    tools.open(ISSUES_URL);
  }
}
