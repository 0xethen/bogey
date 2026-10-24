import { expect, test } from "vite-plus/test";
import type { RosterNote } from "@bogey/utils/roster";
import { groupCorrections } from "../src/routes/_authed/events/$slug/manage/-components/roster-corrections.tsx";

const note = (kind: RosterNote["kind"], line: number): RosterNote => ({
  kind,
  line,
  message: `${kind} ${line}`,
});

test("three or more of a kind go under one heading where the first was", () => {
  const entries = groupCorrections([
    note("duplicate", 2),
    note("looseMate", 3),
    note("looseMate", 5),
    note("tooBig", 6),
    note("looseMate", 9),
  ]);
  expect(
    entries.map((entry) => (entry.kind === "group" ? `group:${entry.of}` : entry.note.message)),
  ).toEqual(["duplicate 2", "group:looseMate", "tooBig 6"]);
  const group = entries[1];
  expect(group?.kind === "group" ? group.notes.map((each) => each.line) : []).toEqual([3, 5, 9]);
});

test("a pair of the same kind stays as two lines", () => {
  const entries = groupCorrections([note("duplicate", 2), note("duplicate", 4)]);
  expect(entries.every((entry) => entry.kind === "note")).toBe(true);
});
