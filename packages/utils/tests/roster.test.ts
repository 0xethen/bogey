import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import {
  matchDivision,
  matchName,
  parseTable,
  planRoster,
  readRoster,
  tableToText,
  teamKey,
  type ColumnKind,
  type RosterCatalog,
} from "../src/roster.ts";
import { parseRules, rulesToText } from "../src/roster-rules.ts";

const form = readFileSync(new URL("./fixtures/registration-form.csv", import.meta.url), "utf8");

const catalog: RosterCatalog = {
  divisions: [
    { id: "ms", name: "Middle school" },
    { id: "hs", name: "High school" },
  ],
  sessions: [
    { id: "git", name: "Git and GitHub" },
    { id: "ai", name: "Programming with AI" },
    { id: "cyber", name: "Cybersecurity and Web Vulnerabilities" },
  ],
  teams: [],
};

let next = 0;
const id = () => `r${next++}`;

test("CSV cells may be quoted, hold commas, quotes and line breaks", () => {
  expect(parseTable('a,"b, c","say ""hi""","two\nlines"\nd,e')).toEqual([
    { line: 1, cells: ["a", "b, c", 'say "hi"', "two\nlines"] },
    { line: 3, cells: ["d", "e"] },
  ]);
});

test("tabs and semicolons work as separators, and a table survives a round trip", () => {
  expect(parseTable("a\tb\nc\td")[1]?.cells).toEqual(["c", "d"]);
  expect(parseTable("a;b;c\n1;2;3")[0]?.cells).toEqual(["a", "b", "c"]);
  const rows = [
    ["name", "note"],
    ["Ada", 'tab\there "quoted"'],
  ];
  expect(parseTable(tableToText(rows)).map((row) => row.cells)).toEqual(rows);
});

test("columns are recognized from a form's headers", () => {
  const kinds = Object.fromEntries(
    readRoster(form).columns.map((column) => [column.header, column.kind]),
  );
  expect(kinds).toMatchObject({
    Timestamp: "ignore",
    "Email Address": "email",
    "Full name": "name",
    "Preferred name": "preferredName",
    "School name": "school",
    "School email": "otherEmail",
    "Grade level": "answer",
    "Are you working solo, or in a team?": "teamMode",
    "Team name": "team",
    "Name of teammate #1": "teammate",
    "School of teammate #2": "teammateSchool",
    "Time Slot 1 (two-hour)": "answer",
    "Would you like us to share your email with our sponsors?": "answer",
    "Anything else?": "answer",
  });
});

test("without a header, columns go email, name, team, role, then teammates", () => {
  const plan = planRoster("ada@x.com, Ada Lovelace, Rockets, , grace@x.com\ngrace@x.com, Grace");
  expect(plan.teams).toEqual([
    {
      name: "Rockets",
      members: ["ada@x.com", "grace@x.com"],
      existing: false,
      asking: false,
    },
  ]);
});

test("unreadable lines are problems; a repeated email keeps the later line", () => {
  const plan = planRoster("email,name\nnope,X\nada@x.com,Ada\nada@x.com,Ada L.\nb@x.com,,,king");
  expect(plan.problems.map((problem) => problem.line)).toEqual([2]);
  expect(plan.people.find((person) => person.email === "ada@x.com")?.name).toBe("Ada L.");
  expect(plan.notes.some((note) => note.message.includes("later line"))).toBe(true);
});

test("team names are compared by what tells them apart", () => {
  expect(teamKey("The A.C.S. Coders")).toBe("acscoders");
  expect(teamKey("Byte Club")).toBe(teamKey("ByteClub"));
});

test("sessions and divisions match by name, never by guessing a grade", () => {
  expect(matchName("Git and GitHub (Beginner)", catalog.sessions)?.id).toBe("git");
  expect(matchName("Programming with AI presented by Amazon", catalog.sessions)?.id).toBe("ai");
  expect(matchName("Pottery", catalog.sessions)).toBeUndefined();
  expect(matchDivision("high school", catalog.divisions)?.id).toBe("hs");
  expect(matchDivision("8th", catalog.divisions)).toBeUndefined();
  expect(matchDivision("Sophomore", catalog.divisions)).toBeUndefined();
});

const kinds: Readonly<Record<number, ColumnKind>> = {
  6: "division",
  13: "session",
  14: "session",
  15: "session",
  16: "session",
};

const plan = planRoster(form, { kinds, catalog });
const person = (email: string) => plan.people.find((each) => each.email === email);

test("teammates named by full, first or preferred name land on one team", () => {
  expect(plan.teams.find((team) => team.name === "A.C.S Coders")?.members).toEqual([
    "maya.rivera@example.com",
    "ethan.park@example.com",
    "nina.patel@example.com",
  ]);
  expect(
    plan.notes.some((note) => note.message.includes('"Maya" is taken to be Maya Rivera')),
  ).toBe(true);
});

test("two spellings of one linked team are a choice, suggesting what most wrote", () => {
  const conflict = plan.conflicts.find((each) => each.kind === "name");
  expect(conflict?.suggested).toBe("use:A.C.S Coders");
  expect(conflict?.options.map((option) => option.id)).toEqual([
    "use:A.C.S.",
    "use:A.C.S Coders",
    "separate",
    "ask",
  ]);
  const asked = planRoster(form, { kinds, catalog, resolutions: { [conflict?.key ?? ""]: "ask" } });
  expect(asked.people.find((each) => each.email === "maya.rivera@example.com")).toMatchObject({
    teamOptions: ["A.C.S.", "A.C.S Coders"],
  });
});

test("spellings that differ only in spacing and punctuation merge, with a note", () => {
  expect(person("ivy.chen@example.com")?.team).toBe("Byte Club");
  expect(person("leo.martin@example.com")?.team).toBe("Byte Club");
  expect(plan.notes.some((note) => note.message.includes('"ByteClub"'))).toBe(true);
});

test("someone solo but named by a teammate is asked by default, or settled by the organizer", () => {
  const conflict = plan.conflicts.find((each) => each.kind === "solo");
  expect(conflict?.key).toBe("solo:oliver.jones@example.com");
  expect(person("oliver.jones@example.com")?.teamOptions).toEqual(["A.C.S Coders"]);
  const joined = planRoster(form, {
    kinds,
    catalog,
    resolutions: { [conflict?.key ?? ""]: "join" },
  });
  expect(joined.people.find((each) => each.email === "oliver.jones@example.com")?.team).toBe(
    "A.C.S Coders",
  );
  const kept = planRoster(form, { kinds, catalog, resolutions: { [conflict?.key ?? ""]: "keep" } });
  expect(
    kept.people.find((each) => each.email === "oliver.jones@example.com")?.team,
  ).toBeUndefined();
});

test("people who asked to be placed are on no team and flagged", () => {
  expect(person("sana.ahmed@example.com")).toMatchObject({ wantsTeam: true });
  expect(person("sana.ahmed@example.com")?.team).toBeUndefined();
});

test("teammates who aren't on the roster are named, not invented", () => {
  const missing = plan.notes.filter((note) => note.message.includes("isn't on the roster"));
  expect(missing.map((note) => note.message.split(" (")[0])).toEqual([
    "Noah",
    "Priya Shah",
    "Chris",
    "Jordan Lee",
  ]);
});

test("a line with a cell missing is pointed out", () => {
  expect(plan.notes.find((note) => note.message.includes("cells but the header"))?.line).toBe(5);
});

test("grades are not turned into divisions; sessions come from workshop picks, the rest as answers", () => {
  expect(person("nina.patel@example.com")?.division).toBeUndefined();
  expect(person("maya.rivera@example.com")).toMatchObject({
    sessions: ["ai", "git", "cyber"],
  });
  const answers = person("marcus.bell@example.com")?.answers ?? {};
  expect(answers["Timestamp"]).toBeUndefined();
  expect(answers["Anything else?"]).toBeUndefined();
  expect(answers["Preferred name"]).toBe("Marc");
});

test("a team already in the event is joined, and a near spelling asks", () => {
  const exact = planRoster(form, { kinds, catalog: { ...catalog, teams: ["byte club"] } });
  expect(exact.people.find((each) => each.email === "ivy.chen@example.com")?.team).toBe(
    "byte club",
  );
  const near = planRoster(form, { kinds, catalog: { ...catalog, teams: ["Byte Clubb"] } });
  expect(near.conflicts.some((each) => each.kind === "similar")).toBe(true);
});

test("every piece of a conflict's evidence names the roster lines it comes from", () => {
  const near = planRoster(form, { kinds, catalog: { ...catalog, teams: ["Byte Clubb"] } });
  const similar = near.conflicts.find((each) => each.kind === "similar");
  const lines = [
    person("ivy.chen@example.com")?.line,
    person("leo.martin@example.com")?.line,
  ].toSorted((a, b) => (a ?? 0) - (b ?? 0));
  expect(similar?.evidence[0]?.lines).toEqual(expect.arrayContaining(lines));
  for (const conflict of [...plan.conflicts, ...near.conflicts]) {
    for (const each of conflict.evidence) {
      expect(each.lines.length).toBeGreaterThan(0);
      expect(each.text).not.toMatch(/^Line \d/);
    }
  }
});

test("corrections say what kind they are", () => {
  expect(plan.notes.find((note) => note.message.includes('"ByteClub"'))?.kind).toBe("readAsOne");
  expect(plan.notes.every((note) => typeof note.kind === "string")).toBe(true);
});

test("a preferred name defaults to the first word of the first name", () => {
  const text = [
    "email,first name,last name,teammate",
    "a@x.com,Mary Ann,Ng,",
    "b@x.com,Zed,Quinn,Mary",
  ].join("\n");
  const named = planRoster(text);
  expect(named.teams.map((team) => team.members)).toEqual([["a@x.com", "b@x.com"]]);
  expect(
    named.notes.some((note) => note.message.includes('"Mary" is taken to be Mary Ann Ng')),
  ).toBe(true);
});

test("two separate groups with one name are numbered unless merged", () => {
  const text = [
    "email,team,teammate",
    "a@x.com,Rockets,b@x.com",
    "b@x.com,Rockets,a@x.com",
    "c@x.com,rockets,d@x.com",
    "d@x.com,Rockets,c@x.com",
  ].join("\n");
  const numbered = planRoster(text);
  expect(numbered.teams.map((team) => team.name).toSorted()).toEqual(["Rockets", "Rockets (2)"]);
  const key = numbered.conflicts[0]?.key ?? "";
  expect(planRoster(text, { resolutions: { [key]: "merge" } }).teams).toHaveLength(1);
});

test("rules read from text and write back the same", () => {
  const text = [
    '[Grade level] is "8th" -> division "Middle school"',
    '[Time Slot 2] contains "Sorting" and [School name] starts with "North" -> session "Git and GitHub"',
    "[Email Address] matches /@example\\.com$/ -> role judge",
    "[Anything else?] is not empty -> no team",
    "* -> skip",
  ].join("\n");
  const { rules, problems } = parseRules(text, id);
  expect(problems).toEqual([]);
  expect(rules.map((rule) => rule.then.kind)).toEqual([
    "division",
    "session",
    "role",
    "no team",
    "skip",
  ]);
  expect(rulesToText(rules)).toBe(text);
});

test("rule mistakes say what's wrong, by line", () => {
  const { problems } = parseRules(
    '# a comment\n[Grade] is 8th -> skip\n[Grade] is "8" division "X"',
    id,
  );
  expect(problems).toEqual([
    { line: 2, message: "Put what [Grade] is in quotes" },
    { line: 3, message: 'Separate the condition from what to do with "->"' },
  ]);
});

test("rules place people, sign them up, and leave them out", () => {
  const { rules } = parseRules(
    [
      '[Grade level] is "12th" -> division "Middle school"',
      '[Time Slot 4] contains "Serverless" -> session "Programming with AI"',
      '[Email Address] is "drew.foster@example.com" -> skip',
      '[Full name] is "Sana Ahmed" -> team "Late Joiners"',
    ].join("\n"),
    id,
  );
  const ruled = planRoster(form, { kinds, catalog, rules });
  const find = (email: string) => ruled.people.find((each) => each.email === email);
  expect(find("marcus.bell@example.com")?.division).toBe("ms");
  expect(find("ethan.park@example.com")?.sessions).toContain("ai");
  expect(find("drew.foster@example.com")).toBeUndefined();
  expect(find("sana.ahmed@example.com")?.team).toBe("Late Joiners");
});

test("guess level none uses only exact headers and exact names", () => {
  const text = "Email,Full name,What school?,Team name\na@x.com,Ann,Gwinnett,Cobol\n";
  const kinds = (guess: "none" | "some" | "max") =>
    readRoster(text, {}, guess).columns.map((column) => column.kind);
  expect(kinds("none")).toEqual(["email", "name", "answer", "team"]);
  expect(kinds("max")).toEqual(["email", "name", "school", "team"]);
});

test("guess level none leaves timestamps and unknown headers alone", () => {
  const text = "Email,Submitted\na@x.com,2026-10-01 10:00\n";
  expect(readRoster(text, {}, "max").columns[1]?.kind).toBe("ignore");
  expect(readRoster(text, {}, "none").columns[1]?.kind).toBe("answer");
});

test("names match more loosely as the guess level rises", () => {
  expect(matchName("High school", catalog.divisions, "none")?.id).toBe("hs");
  expect(matchName("high school students", catalog.divisions, "none")).toBeUndefined();
  expect(matchName("high school students", catalog.divisions, "some")?.id).toBe("hs");
  expect(matchName("Programming AI", catalog.sessions, "some")).toBeUndefined();
  expect(matchName("Programming AI", catalog.sessions, "max")?.id).toBe("ai");
});

test("similar team names only merge when guessing", () => {
  const text = "a@x.com,Ann,Cobolers\nb@x.com,Bo,Coboler\n";
  const similar = (guess: "none" | "some" | "max") =>
    planRoster(text, { guess }).conflicts.filter((conflict) => conflict.kind === "similar").length;
  expect(similar("none")).toBe(0);
  expect(similar("some")).toBeGreaterThan(0);
  expect(similar("max")).toBeGreaterThan(0);
});

test("one guess level applies to every row of a batch", () => {
  const text = [
    "Email,Full name,Grade level,Workshop",
    "a@x.com,Ann,High school,Git and GitHub",
    "b@x.com,Bo,high school students,Programming AI",
    "c@x.com,Cy,Middle school,Programming with AI",
  ].join("\n");
  const batch = (guess: "none" | "some" | "max") =>
    planRoster(text, { kinds: { 2: "division", 3: "session" }, catalog, guess }).people.map(
      (each) => [each.email, each.division ?? "", each.sessions.join()],
    );
  expect(batch("none")).toEqual([
    ["a@x.com", "hs", "git"],
    ["b@x.com", "", ""],
    ["c@x.com", "ms", "ai"],
  ]);
  expect(batch("some")).toEqual([
    ["a@x.com", "hs", "git"],
    ["b@x.com", "hs", ""],
    ["c@x.com", "ms", "ai"],
  ]);
  expect(batch("max")).toEqual([
    ["a@x.com", "hs", "git"],
    ["b@x.com", "hs", "ai"],
    ["c@x.com", "ms", "ai"],
  ]);
});

test("guessing defaults to max when no level is given", () => {
  const text = "a@x.com,Ann,Cobolers\nb@x.com,Bo,Coboler\n";
  expect(planRoster(text).conflicts).toEqual(planRoster(text, { guess: "max" }).conflicts);
});
