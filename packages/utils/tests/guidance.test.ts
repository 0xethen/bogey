import { expect, test } from "vite-plus/test";
import {
  bandFor,
  evenBands,
  nextBand,
  overlappingBands,
  parseRange,
  readGuidance,
  readGuidancePaste,
  readGuidanceTable,
  readGuidanceText,
  scoreLine,
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

const RUBRIC = `Row A
Practicality & Relevance
0 points.

Ex: Platform that segments tumor masses in X-rays.
1 point.

Ex: Text-to-speech app for medical appointments.
Row B
Creativity & Innovation
0 points.

Ex: Clone of an existing project.
1 point.

Ex: Standard medication reminder app.
2 points.

Ex: Medication reminder app that buzzes.`;

test("score lines need a points word or a mark after the number", () => {
  expect(scoreLine("0 points.")).toEqual({ min: 0, max: 0, rest: "" });
  expect(scoreLine("7-8 pts: works end to end")).toEqual({
    min: 7,
    max: 8,
    rest: "works end to end",
  });
  expect(scoreLine("- 3: strong")).toEqual({ min: 3, max: 3, rest: "strong" });
  expect(scoreLine("3D printing")).toBeNull();
  expect(scoreLine("3 teams tried")).toBeNull();
});

test("a rubric written as text reads with Row markers", () => {
  const { criteria, problems } = readGuidanceText(RUBRIC);
  expect(problems).toEqual([]);
  expect(criteria.map((each) => each.label)).toEqual([
    "Practicality & Relevance",
    "Creativity & Innovation",
  ]);
  expect(criteria[0]!.guidance).toEqual([
    { min: 0, max: 0, body: "Ex: Platform that segments tumor masses in X-rays." },
    { min: 1, max: 1, body: "Ex: Text-to-speech app for medical appointments." },
  ]);
  expect(criteria[1]!.guidance.map((band) => band.max)).toEqual([0, 1, 2]);
});

test("without markers, a score that starts over begins the next criterion", () => {
  const { criteria } = readGuidanceText(RUBRIC.replace(/^Row [AB]\n/gm, ""));
  expect(criteria.map((each) => each.label)).toEqual([
    "Practicality & Relevance",
    "Creativity & Innovation",
  ]);
  expect(criteria[0]!.guidance).toHaveLength(2);
});

test("text between a name and its first score is its description", () => {
  const { criteria } = readGuidanceText(
    "## Impact\nDoes it matter?\n1-3: barely\n4-5 points: a lot\nmore so",
  );
  expect(criteria).toEqual([
    {
      line: 1,
      label: "Impact",
      description: "Does it matter?",
      weight: null,
      guidance: [
        { min: 1, max: 3, body: "barely" },
        { min: 4, max: 5, body: "a lot\n\nmore so" },
      ],
    },
  ]);
});

test("a score before any name is a problem", () => {
  expect(readGuidanceText("0 points.\nnothing").problems).toEqual([{ kind: "noLabel", line: 1 }]);
});

test("pasted tables still read as tables", () => {
  const pasted = readGuidancePaste("Criterion\t1-3\t4-5\nImpact\tlow\thigh");
  expect(pasted.criteria[0]!.guidance).toHaveLength(2);
  expect(readGuidancePaste(RUBRIC).criteria).toHaveLength(2);
});
