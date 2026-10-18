import { expect, test } from "vite-plus/test";
import { columnName, sheetName, xlsxFiles } from "../src/xlsx.ts";

test("names columns like a spreadsheet", () => {
  expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
    "A",
    "Z",
    "AA",
    "AB",
    "AZ",
    "BA",
    "ZZ",
    "AAA",
  ]);
});

test("keeps sheet names to what Excel allows", () => {
  expect(sheetName("Projects: A/B [final]")).toBe("Projects  A B  final");
  expect(sheetName("x".repeat(40))).toHaveLength(31);
  expect(sheetName("///")).toBe("Sheet1");
});

test("writes text inline, numbers as numbers and a bold header", () => {
  const files = xlsxFiles(
    "Projects",
    ["Title", "Score"],
    [
      ["=1+1 & <b>", 87.5],
      [null, true],
    ],
  );
  const sheet = files["xl/worksheets/sheet1.xml"] ?? "";
  expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Title</t>');
  expect(sheet).toContain('<t xml:space="preserve">=1+1 &amp; &lt;b&gt;</t>');
  expect(sheet).toContain('<c r="B2"><v>87.5</v></c>');
  expect(sheet).toContain('<row r="3"><c r="B3" t="b"><v>1</v></c></row>');
  expect(sheet).toContain('<autoFilter ref="A1:B3"/>');
  expect(Object.keys(files)).toContain("[Content_Types].xml");
});

test("drops characters XML can't hold", () => {
  const sheet = xlsxFiles("S", ["a\u0001b"], [])["xl/worksheets/sheet1.xml"] ?? "";
  expect(sheet).toContain(">ab</t>");
});
