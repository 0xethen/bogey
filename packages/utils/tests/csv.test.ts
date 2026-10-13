import { expect, test } from "vite-plus/test";
import { BOM, csvChunks, encodeCell, encodeRow, toCsv } from "../src/csv.ts";

test("quotes cells with commas, quotes and line breaks", () => {
  expect(encodeCell("plain")).toBe("plain");
  expect(encodeCell("a,b")).toBe('"a,b"');
  expect(encodeCell('say "hi"')).toBe('"say ""hi"""');
  expect(encodeCell("two\nlines")).toBe('"two\nlines"');
});

test("escapes anything a spreadsheet would run as a formula", () => {
  for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
    expect(encodeCell(`${start}1+1`).replace(/^"|"$/g, "")).toMatch(/^'/);
  }
  expect(encodeCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  expect(encodeCell("fine=ok")).toBe("fine=ok");
});

test("leaves numbers, booleans, dates and blanks alone", () => {
  expect(encodeRow([-4, 2.5, true, null, undefined, new Date("2026-10-09T12:00:00Z")])).toBe(
    "-4,2.5,true,,,2026-10-09T12:00:00.000Z",
  );
});

test("writes a header and CRLF rows, with an optional BOM", () => {
  const csv = toCsv(["a", "b"], [["1", "x,y"]]);
  expect(csv).toBe('a,b\r\n1,"x,y"\r\n');
  expect(toCsv(["a"], [], { bom: true })).toBe(`${BOM}a\r\n`);
});

test("chunks join to the same text", () => {
  const rows = [
    ["1", "a"],
    ["2", "=b"],
  ];
  expect([...csvChunks(["n", "t"], rows)].join("")).toBe(toCsv(["n", "t"], rows));
});
