import type { CsvCell } from "./csv.ts";

// The parts of a one-sheet .xlsx workbook, as path -> XML; zip them (stored or deflated) to get the
// file. Text goes in as inline strings, so nothing in a cell is ever read as a formula.

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML 1.0 can't hold control characters other than tab and line breaks, or U+FFFE/U+FFFF
const xmlSafe = (char: string) => {
  const code = char.charCodeAt(0);
  return code >= 0x20
    ? code !== 0xfffe && code !== 0xffff
    : char === "\t" || char === "\n" || char === "\r";
};

const escapeXml = (text: string) =>
  [...text]
    .filter(xmlSafe)
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cellXml(cell: CsvCell, ref: string, style: number): string {
  const s = style ? ` s="${style}"` : "";
  if (cell === null || cell === undefined || cell === "") return "";
  if (typeof cell === "number" && Number.isFinite(cell))
    return `<c r="${ref}"${s}><v>${cell}</v></c>`;
  if (typeof cell === "boolean") return `<c r="${ref}"${s} t="b"><v>${cell ? 1 : 0}</v></c>`;
  const text = cell instanceof Date ? cell.toISOString() : String(cell);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

// sheet names: at most 31 characters, none of []:*?/\
export function sheetName(text: string): string {
  return (
    text
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet1"
  );
}

export function xlsxFiles(
  sheet: string,
  header: Tuple<string>,
  rows: Iterable<Tuple<CsvCell>>,
): Record<string, string> {
  const lines: string[] = [];
  const widths = header.map((label) => Math.max(8, label.length));
  const row = (cells: Tuple<CsvCell>, index: number, style: number) => {
    cells.forEach((cell, column) => {
      const length = cell === null || cell === undefined ? 0 : String(cell).length;
      widths[column] = Math.min(60, Math.max(widths[column] ?? 8, length));
    });
    const xml = cells.map((cell, column) =>
      cellXml(cell, `${columnName(column)}${index + 1}`, style),
    );
    lines.push(`<row r="${index + 1}">${xml.join("")}</row>`);
  };
  row(header, 0, 1);
  let count = 1;
  for (const cells of rows) row(cells, count++, 0);

  const cols = widths.map(
    (width, index) =>
      `<col min="${index + 1}" max="${index + 1}" width="${width + 2}" customWidth="1"/>`,
  );
  const last = `${columnName(Math.max(0, header.length - 1))}${count}`;
  const worksheet =
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    (cols.length ? `<cols>${cols.join("")}</cols>` : "") +
    `<sheetData>${lines.join("")}</sheetData>` +
    (header.length ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`;

  return {
    "[Content_Types].xml":
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${escapeXml(sheetName(sheet))}" sheetId="1" r:id="rId1"/></sheets>` +
      (header.length
        ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${escapeXml(sheetName(sheet)).replaceAll("'", "''")}'!$A$1:$${columnName(header.length - 1)}$${count}</definedName></definedNames>`
        : "") +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    "xl/styles.xml":
      `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`,
    "xl/worksheets/sheet1.xml": worksheet,
  };
}
