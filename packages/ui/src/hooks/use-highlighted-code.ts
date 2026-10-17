import { useMemo, type ReactNode } from "react";
import { highlightCode } from "@bogey/ui/lib/highlighter";

/**
 * One React node per line of `code`, highlighted as `language`, for
 * `CodeBlockLine`. A language the highlighter doesn't know gives plain lines.
 */
export function useHighlightedCode(value: string, language: string): Tuple<ReactNode> {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value;
  return useMemo(() => highlightCode(code, language) ?? code.split("\n"), [code, language]);
}
