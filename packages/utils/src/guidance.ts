import { parseTable } from "./roster.ts";

/** What a band of scores on one criterion means, like "7-8: works end to end". */
export interface GuidanceBand {
  min: number;
  max: number;
  body: string;
}

export const MAX_BANDS = 20;
export const MAX_BAND_BODY = 2000;

/** Reads criteria.guidance, skipping anything malformed. */
export function readGuidance(value: unknown): GuidanceBand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): GuidanceBand[] => {
    if (typeof item !== "object" || item === null) return [];
    const { min, max, body } = item as Record<string, unknown>;
    return typeof min === "number" && typeof max === "number" && typeof body === "string"
      ? [{ min, max, body }]
      : [];
  });
}

export function sortBands(bands: Tuple<GuidanceBand>): GuidanceBand[] {
  return [...bands].sort((a, b) => a.min - b.min || a.max - b.max);
}

/** The band a score falls in, if any. */
export function bandFor(bands: Tuple<GuidanceBand>, score: number | null): GuidanceBand | null {
  if (score === null) return null;
  return bands.find((band) => score >= band.min && score <= band.max) ?? null;
}

/** A range for the next band: right after the highest one, inside min..max. */
export function nextBand(
  bands: Tuple<Pick<GuidanceBand, "min" | "max">>,
  min: number,
  max: number,
): { min: number; max: number } {
  const top = bands.reduce((high, band) => Math.max(high, band.max), min - 1);
  const start = Math.min(top + 1, max);
  return { min: start, max };
}

/** Splits min..max into `count` bands as evenly as whole numbers allow. */
export function evenBands(min: number, max: number, count: number): { min: number; max: number }[] {
  const span = max - min + 1;
  const parts = Math.max(1, Math.min(count, span));
  return Array.from({ length: parts }, (_, index) => ({
    min: min + Math.floor((span * index) / parts),
    max: min + Math.floor((span * (index + 1)) / parts) - 1,
  }));
}

/** The index pairs of bands that share a score. */
export function overlappingBands(
  bands: Tuple<Pick<GuidanceBand, "min" | "max">>,
): [number, number][] {
  const pairs: [number, number][] = [];
  bands.forEach((band, index) => {
    for (let other = index + 1; other < bands.length; other++) {
      const next = bands[other]!;
      if (band.min <= next.max && next.min <= band.max) pairs.push([index, other]);
    }
  });
  return pairs;
}

const RANGE = /(\d+)\s*(?:-|–|—|to|a|~)\s*(\d+)/i;
const SINGLE = /^\D*?(\d+)\D*$/;

/** Reads "7-8", "7 to 8", "Strong (7–8)" or "10" as a range, with any words around it as a name. */
export function parseRange(text: string): { min: number; max: number; name: string } | null {
  const trimmed = text.trim();
  const ranged = RANGE.exec(trimmed);
  const match = ranged ?? SINGLE.exec(trimmed);
  if (!match) return null;
  const low = Number(match[1]);
  const high = Number(ranged ? match[2] : match[1]);
  const name = trimmed
    .replace(ranged ? match[0] : match[1]!, "")
    .replace(/\b(points?|pts)\b/gi, "")
    .replace(/[()[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,–—-]+|[\s,–—-]+$/g, "");
  return { min: Math.min(low, high), max: Math.max(low, high), name };
}

export interface ImportedCriterion {
  line: number;
  label: string;
  description: string | null;
  weight: number | null;
  guidance: GuidanceBand[];
}

export type GuidanceProblem =
  | { kind: "empty" }
  | { kind: "noBands" }
  | { kind: "badRange"; line: number; text: string }
  | { kind: "noLabel"; line: number }
  | { kind: "badWeight"; line: number; text: string }
  | { kind: "tooMany"; line: number; label: string };

export interface GuidanceImport {
  criteria: ImportedCriterion[];
  problems: GuidanceProblem[];
}

export interface GuidanceRow {
  line: number;
  cells: Tuple<string>;
}

const LABEL = /^(criteri(on|a)|name|category|area|criterio|nombre)$/i;
const DESCRIPTION = /^(description|details|about|descripci[oó]n)$/i;
const WEIGHT = /^(weight|peso)$/i;
const FROM = /^(from|min|low|lowest|desde|m[ií]nimo)$/i;
const TO = /^(to|max|high|highest|top|hasta|m[aá]ximo)$/i;
const SCORES = /^(range|scores?|band|points|rango|puntos)$/i;
const BODY = /^(guidance|looks like|what it looks like|meaning|gu[ií]a)$/i;

const bandBody = (name: string, cell: string) => (name ? `**${name}:** ${cell}` : cell);

/**
 * Reads a guidance table, in either shape:
 * wide, one row per criterion with a column per band ("Criterion | 1-3 | 4-6 | 7-10"), or
 * long, one row per band ("Criterion | From | To | Guidance", or a single "Range" column).
 */
export function readGuidanceTable(rows: Tuple<GuidanceRow>): GuidanceImport {
  const [header, ...body] = rows.filter((row) => row.cells.some((cell) => cell.trim()));
  if (!header) return { criteria: [], problems: [{ kind: "empty" }] };
  const heads = header.cells.map((cell) => cell.trim());
  const find = (pattern: RegExp) => heads.findIndex((cell) => pattern.test(cell));
  const labelAt = Math.max(find(LABEL), 0);
  const descriptionAt = find(DESCRIPTION);
  const weightAt = find(WEIGHT);
  const fromAt = find(FROM);
  const toAt = find(TO);
  const scoresAt = find(SCORES);
  const bodyAt = find(BODY);
  const named = new Set([labelAt, descriptionAt, weightAt, fromAt, toAt, scoresAt, bodyAt]);
  const bandColumns = heads.flatMap((cell, index) => {
    if (named.has(index)) return [];
    const range = parseRange(cell);
    return range ? [{ index, ...range }] : [];
  });
  const long = bandColumns.length === 0 && bodyAt >= 0 && (scoresAt >= 0 || fromAt >= 0);
  if (!long && bandColumns.length === 0) {
    return { criteria: [], problems: [{ kind: "noBands" }] };
  }

  const problems: GuidanceProblem[] = [];
  const byLabel = new Map<string, ImportedCriterion>();
  const order: ImportedCriterion[] = [];
  const cell = (row: GuidanceRow, index: number) =>
    (index >= 0 ? (row.cells[index] ?? "") : "").trim();

  for (const row of body) {
    const label = cell(row, labelAt).slice(0, 80);
    if (!label) {
      problems.push({ kind: "noLabel", line: row.line });
      continue;
    }
    const key = label.toLowerCase();
    let criterion = byLabel.get(key);
    if (!criterion) {
      criterion = { line: row.line, label, description: null, weight: null, guidance: [] };
      byLabel.set(key, criterion);
      order.push(criterion);
    }
    const description = cell(row, descriptionAt);
    if (description) criterion.description = description.slice(0, 2000);
    const weight = cell(row, weightAt);
    if (weight) {
      const value = Number(weight);
      if (Number.isFinite(value) && value > 0 && value <= 100) criterion.weight = value;
      else problems.push({ kind: "badWeight", line: row.line, text: weight });
    }

    const add = (band: GuidanceBand) => {
      if (criterion.guidance.length >= MAX_BANDS) {
        problems.push({ kind: "tooMany", line: row.line, label });
        return;
      }
      criterion.guidance.push({ ...band, body: band.body.slice(0, MAX_BAND_BODY) });
    };
    if (long) {
      const text = cell(row, bodyAt);
      if (!text) continue;
      const range =
        scoresAt >= 0
          ? parseRange(cell(row, scoresAt))
          : parseRange(`${cell(row, fromAt)}-${cell(row, toAt) || cell(row, fromAt)}`);
      if (!range) {
        problems.push({
          kind: "badRange",
          line: row.line,
          text:
            scoresAt >= 0
              ? cell(row, scoresAt)
              : [cell(row, fromAt), cell(row, toAt)].filter(Boolean).join(" "),
        });
        continue;
      }
      add({ min: range.min, max: range.max, body: bandBody(range.name, text) });
    } else {
      for (const column of bandColumns) {
        const text = cell(row, column.index);
        if (text) add({ min: column.min, max: column.max, body: bandBody(column.name, text) });
      }
    }
  }
  for (const criterion of order) criterion.guidance = sortBands(criterion.guidance);
  return { criteria: order, problems };
}

// "Row A", "Criterion 2: Impact", "Part III"
const MARKER =
  /^(?:row|criterion|criteria|category|part|section)\s+(?:[a-z]|\d+|[ivx]+)\b\s*[:.)–—-]?\s*(.*)$/i;
// "0 points.", "7-8 pts: works", "3:", "2)"
const SCORE =
  /^(\d{1,3})(?:\s*(?:-|–|—|to)\s*(\d{1,3}))?\s*(points?|pts?)?\b\s*([.:)–—-])?\s*(.*)$/i;
const BULLET = /^(?:[-*•]\s+|#{1,6}\s+)/;

/** A pasted line that starts a score band, with the text after it. */
export function scoreLine(text: string): { min: number; max: number; rest: string } | null {
  const match = SCORE.exec(text.trim().replace(BULLET, ""));
  if (!match) return null;
  const [, low, high, points, mark, rest = ""] = match;
  if (!points && !mark && rest) return null;
  const min = Number(low);
  const max = Number(high ?? low);
  return { min: Math.min(min, max), max: Math.max(min, max), rest: rest.trim() };
}

/** Whether a pasted line marks the start of a criterion, like "Row A". */
export const isMarkerLine = (text: string) => MARKER.test(text.trim());

/**
 * Reads a rubric written out as text: a criterion's name, then its score bands
 * ("0 points." followed by what earns them). "Row A" style lines and headings
 * start a criterion; a band whose score starts over also does.
 */
export function readGuidanceText(text: string): GuidanceImport {
  const lines = text.split(/\r?\n/);
  const criteria: ImportedCriterion[] = [];
  const problems: GuidanceProblem[] = [];
  let current: ImportedCriterion | null = null;
  let band: GuidanceBand | null = null;
  let fresh = false;
  const bodyOf = (at: number) => {
    for (let next = at + 1; next < lines.length; next++) {
      const line = lines[next]!.trim();
      if (line) return line;
    }
    return "";
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;
    if (!line) return;
    const marker = MARKER.exec(line);
    if (marker) {
      band = null;
      current = null;
      fresh = true;
      const label = marker[1]?.trim();
      if (label) start(label, number);
      return;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      band = null;
      start(heading[1], number);
      return;
    }
    const score = scoreLine(line);
    if (score) {
      if (!current) {
        problems.push({ kind: "noLabel", line: number });
        return;
      }
      if (current.guidance.length >= MAX_BANDS) {
        problems.push({ kind: "tooMany", line: number, label: current.label });
        band = null;
        return;
      }
      band = { min: score.min, max: score.max, body: score.rest };
      current.guidance.push(band);
      return;
    }
    const plain = line.replace(BULLET, "");
    // a line before a score that starts over names the next criterion
    const next = scoreLine(bodyOf(index));
    const restarts = !!band && !!band.body && !!next && next.min <= band.max;
    if (!current || fresh || restarts) {
      fresh = false;
      band = null;
      start(plain, number);
    } else if (band) {
      band.body = band.body ? `${band.body}\n\n${plain}` : plain;
    } else {
      current.description = current.description ? `${current.description}\n\n${plain}` : plain;
    }
  });

  function start(label: string, line: number) {
    fresh = false;
    current = { line, label: label.slice(0, 80), description: null, weight: null, guidance: [] };
    criteria.push(current);
  }

  for (const criterion of criteria) {
    if (criterion.description) criterion.description = criterion.description.slice(0, 2000);
    criterion.guidance = sortBands(
      criterion.guidance.map((each) => ({ ...each, body: each.body.slice(0, MAX_BAND_BODY) })),
    );
  }
  if (!criteria.length) problems.push({ kind: "empty" });
  return { criteria, problems };
}

/** Reads pasted criteria: a table (with tabs or a header the table reader knows) or rubric text. */
export function readGuidancePaste(text: string): GuidanceImport {
  if (!text.trim()) return { criteria: [], problems: [{ kind: "empty" }] };
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  if (first.includes("\t")) return readGuidanceTable(parseTable(text));
  const table = readGuidanceTable(parseTable(text));
  if (table.criteria.some((criterion) => criterion.guidance.length)) return table;
  return readGuidanceText(text);
}
