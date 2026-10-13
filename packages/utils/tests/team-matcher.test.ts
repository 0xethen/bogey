import { expect, test } from "vite-plus/test";
import {
  joinLabels,
  parseLabels,
  propose,
  utcOffsetHours,
  type OpenTeam,
  type Person,
} from "../src/team-matcher.ts";

function person(id: string, skills: string[], extra: Partial<Person> = {}): Person {
  return { id, name: id, skills, interests: [], timezone: null, division: null, ...extra };
}

const sizes = { min: 2, max: 4, target: 4 };

test("new teams are made of about the target size and spread skills", () => {
  const people = [
    person("a", ["design"]),
    person("b", ["design"]),
    person("c", ["backend"]),
    person("d", ["backend"]),
    person("e", ["frontend"]),
    person("f", ["frontend"]),
    person("g", ["ml"]),
    person("h", ["ml"]),
  ];
  const { groups, unmatched } = propose(people, [], { min: 2, max: 4, target: 4 });
  expect(unmatched).toEqual([]);
  expect(groups.length).toBe(2);
  for (const group of groups) {
    expect(group.members.length).toBe(4);
    const skills = new Set(group.members.map((id) => people.find((p) => p.id === id)?.skills[0]));
    expect(skills.size, "every skill appears once in each team").toBe(4);
  }
});

test("existing teams with room are filled before new ones are made", () => {
  const teams: OpenTeam[] = [
    { id: "t1", name: "Owls", members: 3, skills: [], division: null, locked: false },
  ];
  const { groups } = propose([person("a", []), person("b", [])], teams, sizes);
  const owls = groups.find((group) => group.team === "t1");
  expect(owls?.members.length, "the team of three takes one to reach four").toBe(1);
  expect(groups.length).toBe(1 + (groups.some((g) => g.team === null) ? 1 : 0));
  expect(groups.every((g) => g.team !== null || g.members.length >= 2)).toBe(true);
});

test("a lone leftover with no room is unmatched, not a team of one", () => {
  const { groups, unmatched } = propose([person("a", []), person("b", []), person("c", [])], [], {
    min: 2,
    max: 2,
    target: 2,
  });
  expect(groups.length).toBe(1);
  expect(unmatched.length).toBe(1);
});

test("locked and full teams are skipped", () => {
  const teams: OpenTeam[] = [
    { id: "locked", name: "L", members: 1, skills: [], division: null, locked: true },
    { id: "full", name: "F", members: 4, skills: [], division: null, locked: false },
  ];
  const { groups } = propose([person("a", []), person("b", [])], teams, sizes);
  expect(groups.every((group) => group.team === null)).toBe(true);
});

test("divisions are never mixed", () => {
  const { groups } = propose(
    [
      person("a", [], { division: "hs" }),
      person("b", [], { division: "hs" }),
      person("c", [], { division: "college" }),
      person("d", [], { division: "college" }),
    ],
    [],
    { min: 2, max: 4, target: 4 },
  );
  expect(groups.length).toBe(2);
  for (const group of groups) expect(group.members.length).toBe(2);
});

test("new teams avoid names already taken", () => {
  const teams: OpenTeam[] = [
    { id: "t", name: "Team 2", members: 4, skills: [], division: null, locked: false },
  ];
  const { groups } = propose([person("a", []), person("b", [])], teams, sizes);
  expect(groups[0]?.name).toBe("Team 3");
});

test("zone offsets read from names, and bad names give null", () => {
  expect(utcOffsetHours("UTC")).toBe(0);
  expect(utcOffsetHours("Asia/Kolkata")).toBe(5.5);
  expect(utcOffsetHours("Nowhere/City")).toBe(null);
  expect(utcOffsetHours(null)).toBe(null);
});

test("labels are trimmed, lowercased, unique and capped", () => {
  expect(parseLabels(" React, ML ,react,, design")).toEqual(["react", "ml", "design"]);
  expect(parseLabels(Array.from({ length: 20 }, (_, i) => `s${i}`).join(",")).length).toBe(12);
  expect(parseLabels("x".repeat(50))[0]?.length).toBe(30);
});

test("labels read back as a list", () => {
  expect(joinLabels(["a", "b"])).toBe("a, b");
});
