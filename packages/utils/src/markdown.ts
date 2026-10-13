export type MarkdownFormat = "bold" | "italic" | "spoiler" | "link";

export interface TextEdit {
  from: number;
  to: number;
  text: string;
  start: number;
  end: number;
}

const MARKERS = { bold: "**", italic: "_", spoiler: "||" } as const;

export function formatMarkdown(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): TextEdit {
  const selected = value.slice(start, end);
  if (format === "link") {
    const label = selected || "link text";
    const urlStart = start + label.length + 3;
    return {
      from: start,
      to: end,
      text: `[${label}](https://)`,
      start: selected ? urlStart : start + 1,
      end: selected ? urlStart + 8 : start + 1 + label.length,
    };
  }
  const marker = MARKERS[format];
  const n = marker.length;
  if (value.slice(start - n, start) === marker && value.slice(end, end + n) === marker) {
    return { from: start - n, to: end + n, text: selected, start: start - n, end: end - n };
  }
  if (selected.length >= 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, -n);
    return { from: start, to: end, text: inner, start, end: start + inner.length };
  }
  return {
    from: start,
    to: end,
    text: `${marker}${selected}${marker}`,
    start: start + n,
    end: end + n,
  };
}

export function insertMarkdown(start: number, end: number, text: string): TextEdit {
  const caret = start + text.length;
  return { from: start, to: end, text, start: caret, end: caret };
}

export function applyEdit(value: string, edit: TextEdit): string {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

const LINK = /\[[^\]\n]*\]\([^)\n]*\)/g;

function occurrences(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

export function activeFormats(value: string, start: number, end: number): Set<MarkdownFormat> {
  const active = new Set<MarkdownFormat>();
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = value.indexOf("\n", end);
  const lineEnd = lineEndAt === -1 ? value.length : lineEndAt;
  const before = value.slice(lineStart, start);
  const after = value.slice(end, lineEnd);
  const inside = value.slice(start, end);

  for (const format of ["bold", "italic", "spoiler"] as const) {
    const marker = MARKERS[format];
    const open = occurrences(format === "italic" ? before.replaceAll("**", "") : before, marker);
    const close = occurrences(format === "italic" ? after.replaceAll("**", "") : after, marker);
    const wrapped =
      inside.length >= 2 * marker.length && inside.startsWith(marker) && inside.endsWith(marker);
    if ((open % 2 === 1 && close > 0) || wrapped) active.add(format);
  }

  const line = value.slice(lineStart, lineEnd);
  for (const match of line.matchAll(LINK)) {
    const from = lineStart + match.index;
    if (start >= from && end <= from + match[0].length) active.add("link");
  }
  return active;
}
