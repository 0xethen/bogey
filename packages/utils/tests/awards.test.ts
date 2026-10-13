import { expect, test } from "vite-plus/test";
import { ordinal, proposeAwards, type RankedEntry } from "../src/awards.ts";

const row = (
  id: string,
  rank: number,
  score: number | null,
  extra: Partial<RankedEntry> = {},
): RankedEntry => ({
  submissionId: id,
  formId: "f1",
  formTitle: "Project",
  score,
  rank,
  divisionRank: rank,
  divisionId: null,
  ...extra,
});

test("ordinals", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal)).toEqual([
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "101st",
    "112th",
  ]);
});

test("proposes the top three overall, ties included, and skips unscored entries", () => {
  const rows = [
    row("a", 1, 90),
    row("b", 2, 80),
    row("c", 2, 80),
    row("d", 4, 70),
    row("e", 5, null),
  ];
  const awards = proposeAwards({ rows, divisions: [], prizes: [], entries: [] });
  expect(awards.map((a) => [a.submissionId, a.label])).toEqual([
    ["a", "1st place"],
    ["b", "2nd place"],
    ["c", "2nd place"],
  ]);
});

test("names the form when there are several", () => {
  const rows = [row("a", 1, 90), row("b", 1, 50, { formId: "f2", formTitle: "Slides" })];
  const labels = proposeAwards({ rows, divisions: [], prizes: [], entries: [] }).map(
    (a) => a.label,
  );
  expect(labels).toEqual(["1st place, Project", "1st place, Slides"]);
});

test("a winner per division", () => {
  const rows = [
    row("a", 1, 90, { divisionId: "hs", divisionRank: 1 }),
    row("b", 2, 80, { divisionId: "ms", divisionRank: 1 }),
    row("c", 3, 70, { divisionId: "hs", divisionRank: 2 }),
  ];
  const divisions = [
    { id: "hs", name: "High school" },
    { id: "ms", name: "Middle school" },
  ];
  const awards = proposeAwards({ rows, divisions, prizes: [], entries: [] }).filter(
    (a) => a.kind === "division",
  );
  expect(awards.map((a) => [a.submissionId, a.label])).toEqual([
    ["a", "High school winner"],
    ["b", "Middle school winner"],
  ]);
});

test("each prize goes to its best entries, up to its winners", () => {
  const rows = [row("a", 1, 90), row("b", 2, 80), row("c", 3, 70)];
  const awards = proposeAwards({
    rows,
    divisions: [],
    prizes: [
      { id: "p1", name: "Best data", maxWinners: 2 },
      { id: "p2", name: "Sponsor pick", maxWinners: 1 },
    ],
    entries: [
      { trackId: "p1", submissionId: "c" },
      { trackId: "p1", submissionId: "b" },
      { trackId: "p1", submissionId: "a" },
      { trackId: "p2", submissionId: "c" },
    ],
    overallPlaces: 0,
  });
  expect(awards.map((a) => [a.label, a.submissionId])).toEqual([
    ["1st in Best data", "a"],
    ["2nd in Best data", "b"],
    ["Sponsor pick", "c"],
  ]);
});

test("the popular vote winner, and nothing when nobody voted", () => {
  const rows = [row("a", 1, 90), row("b", 2, 80)];
  const base = { rows, divisions: [], prizes: [], entries: [], overallPlaces: 0 };
  expect(
    proposeAwards({
      ...base,
      votes: [
        { submissionId: "b", count: 7 },
        { submissionId: "a", count: 3 },
      ],
    }).map((a) => a.submissionId),
  ).toEqual(["b"]);
  expect(proposeAwards({ ...base, votes: [] })).toEqual([]);
});
