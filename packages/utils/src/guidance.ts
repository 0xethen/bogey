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
