export type MarkdownFormat = "bold" | "italic" | "underline" | "spoiler" | "link" | "h1" | "h2";

/** Optional syntax a Markdown field accepts; bold, italic, underline and spoilers always work. */
export interface MarkdownFeatures {
  headings: boolean;
  links: boolean;
  lists: boolean;
  code: boolean;
  images: boolean;
}

export const MARKDOWN_PRESETS = {
  /** Long-form content: pages, announcements, event about. */
  full: { headings: true, links: true, lists: true, code: true, images: true },
  /** Chat and conversation messages. */
  message: { headings: false, links: true, lists: true, code: true, images: true },
  /** Short descriptions shown inline in lists and cards. */
  short: { headings: false, links: true, lists: true, code: false, images: false },
  /** Single-line values such as a prize. */
  plain: { headings: false, links: false, lists: false, code: false, images: false },
  /** Email templates; the email renderer has no images. */
  email: { headings: true, links: true, lists: true, code: true, images: false },
} as const satisfies Record<string, MarkdownFeatures>;

export type MarkdownPreset = keyof typeof MARKDOWN_PRESETS;
export type MarkdownFeatureSet = MarkdownPreset | Partial<MarkdownFeatures>;

export function markdownFeatures(set: MarkdownFeatureSet = "full"): MarkdownFeatures {
  return typeof set === "string" ? MARKDOWN_PRESETS[set] : { ...MARKDOWN_PRESETS.full, ...set };
}

/** Whether a toolbar format is available under a feature set. */
export function formatAllowed(format: MarkdownFormat, features: MarkdownFeatures): boolean {
  if (format === "link") return features.links;
  if (format === "h1" || format === "h2") return features.headings;
  return true;
}

export interface TextEdit {
  from: number;
  to: number;
  text: string;
  start: number;
  end: number;
}

const MARKERS = { bold: "**", italic: "_", underline: "++", spoiler: "||" } as const;
const HEADINGS = { h1: "# ", h2: "## " } as const;
const HEADING_PREFIX = /^#{1,6}[ \t]+/;

function lineBounds(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const at = value.indexOf("\n", end);
  return [from, at === -1 ? value.length : at];
}

function formatHeading(value: string, start: number, end: number, format: "h1" | "h2"): TextEdit {
  const [from, to] = lineBounds(value, start, end);
  const line = value.slice(from, to);
  const current = HEADING_PREFIX.exec(line)?.[0] ?? "";
  const prefix = current.trimEnd() === HEADINGS[format].trimEnd() ? "" : HEADINGS[format];
  const delta = prefix.length - current.length;
  const clamp = (at: number) => Math.max(from + prefix.length, at + delta);
  return {
    from,
    to,
    text: prefix + line.slice(current.length),
    start: clamp(start),
    end: clamp(end),
  };
}

export function formatMarkdown(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): TextEdit {
  if (format === "h1" || format === "h2") return formatHeading(value, start, end, format);
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

  for (const format of ["bold", "italic", "underline", "spoiler"] as const) {
    const marker = MARKERS[format];
    const open = occurrences(format === "italic" ? before.replaceAll("**", "") : before, marker);
    const close = occurrences(format === "italic" ? after.replaceAll("**", "") : after, marker);
    const wrapped =
      inside.length >= 2 * marker.length && inside.startsWith(marker) && inside.endsWith(marker);
    if ((open % 2 === 1 && close > 0) || wrapped) active.add(format);
  }

  const line = value.slice(lineStart, lineEnd);
  const heading = HEADING_PREFIX.exec(line)?.[0].trimEnd();
  if (heading === "#") active.add("h1");
  if (heading === "##") active.add("h2");
  for (const match of line.matchAll(LINK)) {
    const from = lineStart + match.index;
    if (start >= from && end <= from + match[0].length) active.add("link");
  }
  return active;
}
