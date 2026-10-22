import { expect, test } from "vite-plus/test";
import {
  bandFor,
  evenBands,
  nextBand,
  overlappingBands,
  parseRange,
  readGuidance,
  readGuidanceTable,
  type GuidanceRow,
} from "../src/guidance.ts";
import { parseTable } from "../src/roster.ts";

const rows = (text: string): GuidanceRow[] => parseTable(text);

test("ranges read from plain and named headers", () => {
  expect(parseRange("7-8")).toEqual({ min: 7, max: 8, name: "" });
  expect(parseRange("7 to 8")).toEqual({ min: 7, max: 8, name: "" });
  expect(parseRange("Strong (7–8)")).toEqual({ min: 7, max: 8, name: "Strong" });
  expect(parseRange("Excellent: 9-10 points")).toEqual({ min: 9, max: 10, name: "Excellent" });
  expect(parseRange("10")).toEqual({ min: 10, max: 10, name: "" });
  expect(parseRange("3 pts")).toEqual({ min: 3, max: 3, name: "" });
  expect(parseRange("8-5")).toEqual({ min: 5, max: 8, name: "" });
  expect(parseRange("Weight")).toBeNull();
});

test("a score finds its band", () => {
  const bands = [
    { min: 0, max: 3, body: "low" },
    { min: 4, max: 10, body: "high" },
  ];
  expect(bandFor(bands, 2)?.body).toBe("low");
  expect(bandFor(bands, 4)?.body).toBe("high");
  expect(bandFor(bands, null)).toBeNull();
  expect(bandFor(bands, 11)).toBeNull();
});

test("bands split a range and the next one follows the top", () => {
  expect(evenBands(1, 10, 3)).toEqual([
    { min: 1, max: 3 },
    { min: 4, max: 6 },
    { min: 7, max: 10 },
  ]);
  expect(evenBands(0, 2, 5)).toHaveLength(3);
  expect(nextBand([{ min: 0, max: 3 }], 0, 10)).toEqual({ min: 4, max: 10 });
  expect(nextBand([], 1, 5)).toEqual({ min: 1, max: 5 });
  expect(nextBand([{ min: 0, max: 10 }], 0, 10)).toEqual({ min: 10, max: 10 });
});

test("overlaps are found by index", () => {
  expect(
    overlappingBands([
      { min: 0, max: 3 },
      { min: 3, max: 5 },
      { min: 6, max: 9 },
    ]),
  ).toEqual([[0, 1]]);
});

test("stored guidance skips malformed entries", () => {
  expect(readGuidance([{ min: 1, max: 2, body: "ok" }, { min: "1" }, null, 4])).toEqual([
    { min: 1, max: 2, body: "ok" },
  ]);
  expect(readGuidance({})).toEqual([]);
});

test("a wide table has a column per band", () => {
  const result = readGuidanceTable(
    rows(
      [
        "Criterion,Weight,Weak (1-3),Fair (4-6),Strong (7-10)",
        "Impact,2,Nobody needs it,Some people,Everyone",
        "Build,,Slides only,,Works end to end",
      ].join("\n"),
    ),
  );
  expect(result.problems).toEqual([]);
  expect(result.criteria).toEqual([
    {
      line: 2,
      label: "Impact",
      description: null,
      weight: 2,
      guidance: [
        { min: 1, max: 3, body: "**Weak:** Nobody needs it" },
        { min: 4, max: 6, body: "**Fair:** Some people" },
        { min: 7, max: 10, body: "**Strong:** Everyone" },
      ],
    },
    {
      line: 3,
      label: "Build",
      description: null,
      weight: null,
      guidance: [
        { min: 1, max: 3, body: "**Weak:** Slides only" },
        { min: 7, max: 10, body: "**Strong:** Works end to end" },
      ],
    },
  ]);
});

test("a long table has a row per band", () => {
  const result = readGuidanceTable(
    rows(
      [
        "Criterion\tFrom\tTo\tGuidance",
        "Impact\t7\t10\tEveryone",
        "Impact\t0\t6\tSome people",
        "Build\tx\t\tOops",
        "\t1\t2\tNo name",
      ].join("\n"),
    ),
  );
  expect(result.criteria).toEqual([
    {
      line: 2,
      label: "Impact",
      description: null,
      weight: null,
      guidance: [
        { min: 0, max: 6, body: "Some people" },
        { min: 7, max: 10, body: "Everyone" },
      ],
    },
    { line: 4, label: "Build", description: null, weight: null, guidance: [] },
  ]);
  expect(result.problems).toEqual([
    { kind: "badRange", line: 4, text: "x" },
    { kind: "noLabel", line: 5 },
  ]);
});

test("a long table can name ranges in one column", () => {
  const result = readGuidanceTable(
    rows(
      "Criteria,Range,Guidance,Description\nDesign,1-5,Rough,How it looks\nDesign,6-10,Polished,",
    ),
  );
  expect(result.criteria[0]?.guidance).toEqual([
    { min: 1, max: 5, body: "Rough" },
    { min: 6, max: 10, body: "Polished" },
  ]);
  expect(result.criteria[0]?.description).toBe("How it looks");
});

test("a table without bands says so", () => {
  expect(readGuidanceTable(rows("Name,Notes\nImpact,hi")).problems).toEqual([{ kind: "noBands" }]);
  expect(readGuidanceTable([]).problems).toEqual([{ kind: "empty" }]);
});
