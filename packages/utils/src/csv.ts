export type CsvCell = string | number | boolean | Date | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function cellText(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "number") return String(cell);
  const text = String(cell);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function encodeCell(cell: CsvCell): string {
  const text = cellText(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function encodeRow(row: Tuple<CsvCell>): string {
  return row.map(encodeCell).join(",");
}

export const BOM = "﻿";

export type CsvOptions = {
  bom?: boolean;
};

export function toCsv(
  header: Tuple<string>,
  rows: Iterable<Tuple<CsvCell>>,
  options: CsvOptions = {},
): string {
  let out = options.bom ? BOM : "";
  out += `${encodeRow(header)}\r\n`;
  for (const row of rows) out += `${encodeRow(row)}\r\n`;
  return out;
}

export function* csvChunks(
  header: Tuple<string>,
  rows: Iterable<Tuple<CsvCell>>,
  options: CsvOptions = {},
): Generator<string, void, undefined> {
  yield `${options.bom ? BOM : ""}${encodeRow(header)}\r\n`;
  for (const row of rows) yield `${encodeRow(row)}\r\n`;
}
