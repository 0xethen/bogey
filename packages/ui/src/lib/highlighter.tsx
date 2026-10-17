import type { ReactNode } from "react";
import { highlighter } from "./highlight.ts";

/**
 * Highlights `code` as `language` and returns one React node per line, for
 * `CodeBlockLine`. Returns null for a language the highlighter doesn't know,
 * so the caller can show plain lines. Synchronous, so it works on the server.
 */
export function highlightCode(code: string, language: string): Tuple<ReactNode> | null {
  const lang = highlighter.normalizeLanguage(language);
  if (lang === "plaintext") return null;
  const lines: Array<Array<ReactNode>> = [[]];
  for (const [index, token] of highlighter.tokenize(code, { lang }).tokens.entries()) {
    const parts = token.value.split("\n");
    for (const [part, text] of parts.entries()) {
      if (part > 0) lines.push([]);
      if (!text) continue;
      lines.at(-1)?.push(
        token.className ? (
          <span key={`${index}-${part}`} className={`th-${token.className}`}>
            {text}
          </span>
        ) : (
          text
        ),
      );
    }
  }
  return lines;
}
