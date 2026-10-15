import { ruleMatches, type ImportRule, type RuleCondition } from "./roster-rules.ts";
import { sayEnglish, type Say } from "./messages.ts";

export type RosterRole = "participant" | "judge" | "staff" | "organizer";
const ROLES: Tuple<RosterRole> = ["participant", "judge", "staff", "organizer"];

const EMAIL = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;
export const isEmail = (text: string) => EMAIL.test(text.trim());

export interface TableRow {
  line: number;
  cells: string[];
}

function separatorOf(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const count = (char: string) => first.split(char).length - 1;
  if (count("\t") > 0) return "\t";
  return count(";") > count(",") ? ";" : ",";
}

export function parseTable(text: string): TableRow[] {
  const separator = separatorOf(text);
  const rows: TableRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell.trim());
    if (cells.some((each) => each !== "")) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === separator) {
      cells.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (cell || cells.length) endRow();
  return rows;
}

export function tableToText(rows: Tuple<Tuple<string>>): string {
  const cell = (text: string) => (/[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return rows.map((row) => row.map(cell).join("\t")).join("\n");
}

export type ColumnKind =
  | "email"
  | "otherEmail"
  | "name"
  | "firstName"
  | "lastName"
  | "preferredName"
  | "team"
  | "teamMode"
  | "teammate"
  | "teammateSchool"
  | "school"
  | "division"
  | "role"
  | "session"
  | "answer"
  | "ignore";

export const COLUMN_KINDS: Tuple<{ kind: ColumnKind; label: string; description: string }> = [
  { kind: "email", label: "Email", description: "Who they are (their account login)" },
  { kind: "otherEmail", label: "Other email", description: "Kept, and used to find teammates" },
  { kind: "name", label: "Full name", description: "" },
  { kind: "firstName", label: "First name", description: "" },
  { kind: "lastName", label: "Last name", description: "" },
  {
    kind: "preferredName",
    label: "Preferred name",
    description: "Kept, and used to find teammates",
  },
  { kind: "team", label: "Team name", description: "" },
  {
    kind: "teamMode",
    label: "Solo or team",
    description: "Whether they're solo, on a team, or want one",
  },
  { kind: "teammate", label: "Teammate", description: "A name or an email" },
  {
    kind: "teammateSchool",
    label: "Teammate's school",
    description: "Tells apart teammates with the same name",
  },
  { kind: "school", label: "School", description: "Kept, and used to find teammates" },
  { kind: "division", label: "Division", description: "Matched to the event's divisions" },
  { kind: "role", label: "Role", description: "participant, judge, staff or organizer" },
  { kind: "session", label: "Session pick", description: "Matched to the agenda's sessions" },
  { kind: "answer", label: "Keep as an answer", description: "Shown on their registration" },
  { kind: "ignore", label: "Leave out", description: "" },
];

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const words = (text: string) =>
  fold(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const TIMESTAMP = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ t]\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?)?$/i;

const NOISE = /^(n\/?a|none|nothing|nope|no comment|-+|\.+|\?+)$/i;

function teammateNumber(header: string): number | undefined {
  const match = /(\d+)/.exec(header);
  return match ? Number(match[1]) : undefined;
}

function guessColumn(header: string, values: Tuple<string>): ColumnKind {
  const h = fold(header);
  const filled = values.filter(Boolean);
  if (!filled.length) return "ignore";
  const allEmails = filled.filter(isEmail).length >= filled.length * 0.6;
  if (/time ?stamp|submitted at|submission time|^date$|start time|completion time/.test(h)) {
    return "ignore";
  }
  if (filled.every((value) => TIMESTAMP.test(value)) && !/birth|dob/.test(h)) return "ignore";
  if (/team ?mate|team member|partner|groupmate|group member/.test(h)) {
    if (/school|college|universit/.test(h)) return "teammateSchool";
    return "teammate";
  }
  if (allEmails) {
    return /school|parent|guardian|alternat|secondary|backup|work|personal|other/.test(h)
      ? "otherEmail"
      : "email";
  }
  if (/solo|alone|on your own|individual|or (in )?a team|team or|working with/.test(h)) {
    return "teamMode";
  }
  if (/team|group name|squad/.test(h)) return "team";
  if (/preferred|nick ?name|goes by/.test(h)) return "preferredName";
  if (/first name|given name|forename/.test(h)) return "firstName";
  if (/last name|surname|family name/.test(h)) return "lastName";
  if (/name/.test(h) && !/school|company|organi[sz]ation|project/.test(h)) return "name";
  if (/^role$|participant type|attending as|^type$/.test(h)) return "role";
  if (/school|college|universit/.test(h)) return "school";
  return "answer";
}

export interface RosterColumn {
  index: number;
  header: string;
  kind: ColumnKind;
  guessed: ColumnKind;
  samples: string[];
}

export interface RosterTable {
  hasHeader: boolean;
  columns: RosterColumn[];
  rows: TableRow[];
}

const POSITIONAL: Tuple<ColumnKind> = ["email", "name", "team", "role"];

export function readRoster(
  text: string,
  kinds: Readonly<Record<number, ColumnKind>> = {},
): RosterTable {
  const all = parseTable(text);
  const first = all[0]?.cells ?? [];
  const hasHeader = !first.some(isEmail);
  const rows = hasHeader ? all.slice(1) : all;
  const width = Math.max(first.length, ...rows.map((row) => row.cells.length));
  const columns: RosterColumn[] = Array.from({ length: width }, (_, index) => {
    const values = rows.map((row) => row.cells[index] ?? "");
    const header = hasHeader ? (first[index] ?? `Column ${index + 1}`) : `Column ${index + 1}`;
    const guessed = hasHeader
      ? guessColumn(header, values)
      : (POSITIONAL[index] ?? (values.some(Boolean) ? "teammate" : "ignore"));
    return {
      index,
      header,
      kind: kinds[index] ?? guessed,
      guessed,
      samples: [...new Set(values.filter(Boolean))].slice(0, 3),
    };
  });
  let seenEmail = false;
  for (const column of columns) {
    if (column.kind !== "email") continue;
    if (seenEmail && kinds[column.index] === undefined) column.kind = "otherEmail";
    seenEmail = true;
  }
  return { hasHeader, columns, rows };
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (rows[i - 1]?.[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (rows[i - 1]?.[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? limit + 1;
}

export function teamKey(name: string): string {
  return words(name)
    .replace(/^(the |team )+/, "")
    .replace(/ team$/, "")
    .replace(/ /g, "");
}

function similarTeams(a: string, b: string): boolean {
  const [x, y] = [teamKey(a), teamKey(b)];
  if (!x || !y || x === y) return x === y;
  const shorter = Math.min(x.length, y.length);
  if (shorter >= 5 && distance(x, y, 2) <= (shorter >= 9 ? 2 : 1)) return true;
  return shorter >= 3 && (x.startsWith(y) || y.startsWith(x));
}

export function matchName<T extends { name: string }>(
  value: string,
  catalog: Tuple<T>,
): T | undefined {
  const v = words(value);
  if (!v) return undefined;
  const exact = catalog.find((item) => words(item.name) === v);
  if (exact) return exact;
  const contained = catalog.filter((item) => {
    const n = words(item.name);
    return n.length >= 3 && (v.includes(n) || n.includes(v));
  });
  if (contained.length === 1) return contained[0];
  if (contained.length > 1) {
    return contained.toSorted((a, b) => words(b.name).length - words(a.name).length)[0];
  }
  const tokens = new Set(v.split(" "));
  let best: { item: T; score: number } | undefined;
  for (const item of catalog) {
    const theirs = new Set(words(item.name).split(" "));
    const shared = [...theirs].filter((token) => tokens.has(token)).length;
    const score = shared / Math.max(theirs.size, tokens.size);
    if (score >= 0.6 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item;
}

export function matchDivision<T extends { name: string }>(
  value: string,
  divisions: Tuple<T>,
): T | undefined {
  return matchName(value, divisions);
}

export type TeamMode = "team" | "solo" | "placed" | "unsaid";
type PlanMode = TeamMode | "asking";

type Ruled = Omit<Person, "mode"> & {
  mode: PlanMode;
  ruledDivision: string | undefined;
  ruledSessions: string[];
};

function teamMode(value: string): TeamMode {
  const v = fold(value);
  if (!v) return "unsaid";
  if (/placed|assign|match me|put me|find me|randomi[sz]e|looking for/.test(v)) return "placed";
  if (/solo|alone|own|myself|individual|by me/.test(v)) return "solo";
  return "team";
}

interface TeammateRef {
  text: string;
  school?: string;
}

interface Person {
  line: number;
  email: string;
  name?: string;
  first?: string;
  last?: string;
  preferred?: string;
  school?: string;
  otherEmails: string[];
  team?: string;
  mode: TeamMode;
  teammates: TeammateRef[];
  division?: string;
  role?: RosterRole;
  sessions: string[];
  answers: Record<string, string>;
  cells: Map<string, string>;
}

function peopleOf(
  table: RosterTable,
  say: Say,
): {
  people: Person[];
  problems: RosterIssue[];
  notes: RosterIssue[];
} {
  const people = new Map<string, Person>();
  const problems: RosterIssue[] = [];
  const notes: RosterIssue[] = [];
  const teammateColumns = table.columns.filter((column) => column.kind === "teammate");

  const width = table.columns.length;
  for (const row of table.rows) {
    if (table.hasHeader && row.cells.length !== width) {
      notes.push({
        line: row.line,
        message: say(
          "roster.cellCount",
          "This line has {cells} cells but the header has {width}, so its later answers may be in the wrong columns; check it",
          { cells: row.cells.length, width },
        ),
      });
    }
    const cell = (column: RosterColumn) => row.cells[column.index]?.trim() ?? "";
    const of = (kind: ColumnKind) => table.columns.filter((column) => column.kind === kind);
    const one = (kind: ColumnKind) => of(kind).map(cell).find(Boolean);

    const email = one("email")?.toLowerCase();
    if (!email || !isEmail(email)) {
      problems.push({
        line: row.line,
        message: email
          ? say("roster.notEmail", '"{email}" isn\'t an email address', { email })
          : say("roster.noEmail", "There's no email address on this line"),
      });
      continue;
    }
    const first = one("firstName");
    const last = one("lastName");
    const name = one("name") ?? ([first, last].filter(Boolean).join(" ") || undefined);
    const role = one("role")?.toLowerCase();
    if (role && !ROLES.some((known) => known === role)) {
      problems.push({
        line: row.line,
        message: say("roster.notRole", '"{role}" isn\'t a role', { role: one("role") ?? "" }),
      });
      continue;
    }

    const teammates: TeammateRef[] = [];
    const schools = of("teammateSchool");
    teammateColumns.forEach((column, position) => {
      const value = cell(column);
      if (!value || NOISE.test(value)) return;
      const number = teammateNumber(column.header);
      const school =
        schools.find((each) => number !== undefined && teammateNumber(each.header) === number) ??
        schools[position];
      const parts = value
        .split(/[;\n]|,(?=\s*\S+@)/)
        .map((part) => part.trim())
        .filter(Boolean);
      const listed =
        parts.length === 1 && parts[0]?.split(/\s+/).every(isEmail)
          ? (parts[0]?.split(/\s+/) ?? [])
          : parts;
      for (const text of listed)
        teammates.push({ text, school: school ? cell(school) || undefined : undefined });
    });

    const answers: Record<string, string> = {};
    for (const column of table.columns) {
      const value = cell(column);
      const kept: ReadonlySet<ColumnKind> = new Set([
        "answer",
        "school",
        "teamMode",
        "otherEmail",
        "preferredName",
        "division",
      ]);
      if (kept.has(column.kind) && value && !NOISE.test(value))
        answers[column.header.slice(0, 80)] = value.slice(0, 2000);
    }

    const team = one("team");
    const mode = (() => {
      const said = teamMode(one("teamMode") ?? "");
      if (said !== "unsaid") return said;
      return team || teammates.length ? "team" : "unsaid";
    })();
    const person: Person = {
      line: row.line,
      email,
      name,
      first: first ?? name?.split(/\s+/)[0],
      last: last ?? (name && name.split(/\s+/).length > 1 ? name.split(/\s+/).at(-1) : undefined),
      preferred: one("preferredName") ?? first?.split(/\s+/)[0],
      school: one("school"),
      otherEmails: of("otherEmail")
        .map(cell)
        .filter(isEmail)
        .map((each) => each.toLowerCase()),
      team: team && !NOISE.test(team) ? team : undefined,
      mode,
      teammates: teammates.filter((ref) => fold(ref.text) !== email),
      division: one("division"),
      role: ROLES.find((known) => known === role),
      sessions: of("session")
        .map(cell)
        .filter((value) => value && !NOISE.test(value)),
      answers,
      cells: new Map(table.columns.map((column) => [fold(column.header), cell(column)])),
    };
    if (person.mode === "solo" && person.team) {
      notes.push({
        line: row.line,
        message: say(
          "roster.soloWithTeam",
          '{name} said they\'re solo but named a team, "{team}"; they stay solo',
          { name: label(person), team: person.team },
        ),
      });
      person.team = undefined;
    }
    const earlier = people.get(email);
    if (earlier) {
      notes.push({
        line: row.line,
        message: say(
          "roster.duplicate",
          "{email} is also on line {line}; this later line is used",
          {
            email,
            line: earlier.line,
          },
        ),
      });
    }
    people.set(email, person);
  }
  return { people: [...people.values()], problems, notes };
}

const label = (person: Pick<Person, "name" | "email">) => person.name ?? person.email;

interface Match {
  person: number | null;
  ambiguous: number[];
  loose: boolean;
}

type Named = Omit<Person, "mode">;

function findTeammate(ref: TeammateRef, claimant: Named, people: Tuple<Named>): Match {
  const self = people.indexOf(claimant);
  const others = people
    .map((person, index) => ({ person, index }))
    .filter(({ index }) => index !== self);
  const text = ref.text.trim();
  if (isEmail(text)) {
    const email = text.toLowerCase();
    const hit = others.find(
      ({ person }) => person.email === email || person.otherEmails.includes(email),
    );
    return { person: hit?.index ?? null, ambiguous: [], loose: false };
  }
  const wanted = words(text);
  const school = words(ref.school ?? claimant.school ?? "");
  const pick = (
    list: Tuple<{ person: Named; index: number }>,
    loose: boolean,
  ): Match | undefined => {
    if (list.length === 1) return { person: list[0]?.index ?? null, ambiguous: [], loose };
    if (list.length > 1 && school) {
      const same = list.filter(({ person }) => words(person.school ?? "") === school);
      if (same.length === 1) return { person: same[0]?.index ?? null, ambiguous: [], loose };
    }
    return list.length
      ? { person: null, ambiguous: list.map(({ index }) => index), loose }
      : undefined;
  };
  const fullNames = (person: Named) =>
    [
      person.name,
      person.preferred && person.last ? `${person.preferred} ${person.last}` : undefined,
    ]
      .filter((each): each is string => !!each)
      .map(words);
  const exact = pick(
    others.filter(({ person }) => fullNames(person).includes(wanted)),
    false,
  );
  if (exact) return exact;
  if (!wanted.includes(" ")) {
    const loose = pick(
      others.filter(({ person }) =>
        [person.first, person.preferred].some((each) => each && words(each) === wanted),
      ),
      true,
    );
    if (loose) return loose;
  }
  if (wanted.length >= 8) {
    const close = pick(
      others.filter(({ person }) =>
        fullNames(person).some((each) => distance(each, wanted, 2) <= 2),
      ),
      true,
    );
    if (close) return close;
  }
  return { person: null, ambiguous: [], loose: false };
}

export interface RosterIssue {
  line?: number;
  message: string;
}

export interface ConflictOption {
  id: string;
  label: string;
  description?: string;
}

export interface RosterConflict {
  key: string;
  kind: "name" | "similar" | "solo" | "sameName";
  title: string;
  evidence: string[];
  options: ConflictOption[];
  suggested: string;
}

export type RosterResolutions = Readonly<Record<string, string>>;

export interface PlannedPerson {
  line: number;
  email: string;
  name?: string;
  team?: string;
  teamOptions?: string[];
  division?: string;
  sessions: string[];
  role?: RosterRole;
  answers: Record<string, string>;
  wantsTeam: boolean;
}

export interface PlannedTeam {
  name: string;
  members: string[];
  existing: boolean;
  asking: boolean;
}

export interface RosterPlan {
  table: RosterTable;
  people: PlannedPerson[];
  teams: PlannedTeam[];
  conflicts: RosterConflict[];
  notes: RosterIssue[];
  problems: RosterIssue[];
}

export interface RosterCatalog {
  divisions: Tuple<{ id: string; name: string }>;
  sessions: Tuple<{ id: string; name: string }>;
  teams: Tuple<string>;
}

export interface PlanOptions {
  kinds?: Readonly<Record<number, ColumnKind>>;
  rules?: Tuple<ImportRule>;
  resolutions?: RosterResolutions;
  catalog?: RosterCatalog;
  maxTeamSize?: number;
  say?: Say;
  locale?: string;
}

const NO_CATALOG: RosterCatalog = { divisions: [], sessions: [], teams: [] };

class Groups {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }
  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root] ?? root;
    this.parent[index] = root;
    return root;
  }
  join(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
  sets(indexes: Iterable<number>): number[][] {
    const out = new Map<number, number[]>();
    for (const index of indexes) {
      const root = this.find(index);
      out.set(root, [...(out.get(root) ?? []), index]);
    }
    return [...out.values()];
  }
}

function commonest(spellings: Tuple<string>): string | undefined {
  const counts = new Map<string, number>();
  for (const spelling of spellings) counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
  return [...counts].toSorted((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
}

const englishList = (items: Tuple<string>) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");

function listIn(locale: string | undefined): (items: Tuple<string>) => string {
  if (!locale || locale === "en") return englishList;
  const format = new Intl.ListFormat(locale, { type: "conjunction" });
  return (items) => format.format(items);
}

export function planRoster(text: string, options: PlanOptions = {}): RosterPlan {
  const catalog = options.catalog ?? NO_CATALOG;
  const resolutions = options.resolutions ?? {};
  const say = options.say ?? sayEnglish;
  const list = listIn(options.locale);
  const table = readRoster(text, options.kinds);
  const read = peopleOf(table, say);
  const notes = [...read.notes];
  const conflicts: RosterConflict[] = [];

  const ruled = read.people.flatMap((person): Ruled[] => {
    let division: string | undefined;
    const sessions: string[] = [];
    let role = person.role;
    let team = person.team;
    let mode: PlanMode = person.mode;
    for (const rule of options.rules ?? []) {
      if (!ruleMatches(rule, person.cells)) continue;
      const action = rule.then;
      if (action.kind === "skip") return [];
      if (action.kind === "division") division = matchName(action.target, catalog.divisions)?.id;
      if (action.kind === "session") {
        const session = matchName(action.target, catalog.sessions)?.id;
        if (session) sessions.push(session);
      }
      if (action.kind === "role") role = action.target;
      if (action.kind === "team") {
        team = action.target;
        mode = "team";
      }
      if (action.kind === "no team") {
        team = undefined;
        mode = "placed";
      }
    }
    return [{ ...person, role, team, mode, ruledDivision: division, ruledSessions: sessions }];
  });

  const people = ruled;
  const who = (index: number) => {
    const person = people[index];
    return person ? label(person) : say("roster.someone", "someone");
  };
  const everyone = people.map((_, index) => index);
  const groups = new Groups(people.length);
  const claimedBy = new Map<number, number[]>();
  const unmatched = new Map<string, { ref: TeammateRef; by: number[] }>();

  people.forEach((person, index) => {
    if (person.mode !== "team") return;
    for (const ref of person.teammates) {
      const match = findTeammate(ref, person, people);
      if (match.person === null) {
        if (match.ambiguous.length) {
          notes.push({
            line: person.line,
            message: say(
              "roster.ambiguousMate",
              '{name}\'s teammate "{mate}" could be {people}; add their email to tell',
              { name: label(person), mate: ref.text, people: list(match.ambiguous.map(who)) },
            ),
          });
          continue;
        }
        const key = `${words(ref.text)}|${words(ref.school ?? "")}`;
        const entry = unmatched.get(key) ?? { ref, by: [] };
        entry.by.push(index);
        unmatched.set(key, entry);
        continue;
      }
      const mate = people[match.person];
      if (!mate) continue;
      if (match.loose) {
        notes.push({
          line: person.line,
          message: say(
            "roster.looseMate",
            '{name}\'s teammate "{mate}" is taken to be {match} (line {line})',
            { name: label(person), mate: ref.text, match: label(mate), line: mate.line },
          ),
        });
      }
      claimedBy.set(match.person, [...(claimedBy.get(match.person) ?? []), index]);
      if (mate.mode === "solo" || mate.mode === "placed") continue;
      if (mate.mode === "unsaid") mate.mode = "team";
      groups.join(index, match.person);
    }
  });

  for (const { ref, by } of unmatched.values()) {
    notes.push({
      line: people[by[0] ?? -1]?.line,
      message: isEmail(ref.text)
        ? say(
            "roster.notOnRoster",
            "{mate}, named by {people}, isn't on the roster; they'll join when they're added",
            {
              mate: ref.school ? `${ref.text} (${ref.school})` : ref.text,
              people: list(by.map(who)),
            },
          )
        : say(
            "roster.notOnRosterName",
            "{mate}, named by {people}, isn't on the roster under that name; they'll join when they're added",
            {
              mate: ref.school ? `${ref.text} (${ref.school})` : ref.text,
              people: list(by.map(who)),
            },
          ),
    });
  }

  for (const [index, by] of claimedBy) {
    const person = people[index];
    if (!person || (person.mode !== "solo" && person.mode !== "placed")) continue;
    const claimant = by[0];
    if (claimant === undefined) continue;
    const key = `solo:${person.email}`;
    const teamName = people[claimant]?.team;
    const solo = person.mode === "solo";
    const named = { name: label(person), people: list(by.map((each) => who(each))) };
    conflicts.push({
      key,
      kind: "solo",
      title: solo
        ? say(
            "roster.soloClaimed",
            "{name} said they're working on their own, but {people} named them as a teammate",
            named,
          )
        : say(
            "roster.placedClaimed",
            "{name} asked to be placed on a team, but {people} named them as a teammate",
            named,
          ),
      evidence: [
        solo
          ? say("roster.soloLine", "Line {line}: {name} said they're working on their own", {
              line: person.line,
              name: label(person),
            })
          : say("roster.placedLine", "Line {line}: {name} asked to be placed on a team", {
              line: person.line,
              name: label(person),
            }),
        ...by.map((each) => {
          const line = people[each]?.line ?? 0;
          const team = people[each]?.team;
          return team
            ? say("roster.listsThemOn", "Line {line}: {name} lists them on {team}", {
                line,
                name: who(each),
                team,
              })
            : say("roster.listsThem", "Line {line}: {name} lists them", { line, name: who(each) });
        }),
      ],
      options: [
        {
          id: "join",
          label: teamName
            ? say("roster.putOn", "Put them on {team}", { team: teamName })
            : say("roster.putOnThat", "Put them on that team"),
        },
        {
          id: "keep",
          label: solo
            ? say("roster.keepSolo", "Keep them solo")
            : say("roster.keepUnplaced", "Keep them unplaced"),
        },
        { id: "ask", label: say("roster.ask", "Ask them when they sign in") },
      ],
      suggested: "ask",
    });
    const choice = resolutions[key] ?? "ask";
    if (choice === "join") {
      person.mode = "team";
      groups.join(index, claimant);
    }
    if (choice === "ask") person.mode = "asking";
  }

  const byKey = new Map<string, number[]>();
  people.forEach((person, index) => {
    if (person.mode !== "team" || !person.team) return;
    const key = teamKey(person.team);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), index]);
  });
  const numbered = new Map<number, string>();
  for (const [key, members] of byKey) {
    const big = groups
      .sets(everyone)
      .filter((set) => set.length >= 2 && set.some((index) => members.includes(index)));
    if (big.length >= 2) {
      const spelling = commonest(members.map((index) => people[index]?.team ?? "")) ?? key;
      const conflictKey = `sameName:${key}`;
      conflicts.push({
        key: conflictKey,
        kind: "sameName",
        title: say("roster.sameName", "{count} different groups call themselves {name}", {
          count: big.length,
          name: spelling,
        }),
        evidence: big.map((set) => list(set.map(who))),
        options: [
          { id: "merge", label: say("roster.oneTeam", "They're one team") },
          {
            id: "number",
            label: say("roster.numberThem", "Number them"),
            description: `${spelling}, ${spelling} (2)...`,
          },
        ],
        suggested: "number",
      });
      if ((resolutions[conflictKey] ?? "number") === "number") {
        big.forEach((set, position) => {
          if (position > 0)
            set.forEach((index) => numbered.set(index, `${spelling} (${position + 1})`));
        });
        const anchor = big[0]?.[0];
        members
          .filter((index) => !big.some((set) => set.includes(index)))
          .forEach((index) => anchor !== undefined && groups.join(index, anchor));
        continue;
      }
    }
    const [anchor, ...rest] = members;
    if (anchor !== undefined) rest.forEach((index) => groups.join(index, anchor));
  }

  interface Team {
    members: number[];
    name: string | undefined;
    options: string[];
    asking: boolean;
  }
  const inTeam = everyone.filter((index) => people[index]?.mode === "team");
  const teams: Team[] = [];
  for (const members of groups.sets(inTeam)) {
    const spellings = members.flatMap((index) => {
      const person = people[index];
      return person?.team ? [numbered.get(index) ?? person.team] : [];
    });
    const distinct = new Map<string, string[]>();
    for (const spelling of spellings) {
      const key = teamKey(spelling) || spelling;
      distinct.set(key, [...(distinct.get(key) ?? []), spelling]);
    }
    const names = [...distinct.values()].map((each) => commonest(each) ?? "").filter(Boolean);
    for (const spellings of distinct.values()) {
      const variants = [...new Set(spellings)];
      if (variants.length > 1) {
        notes.push({
          message: say("roster.readAsOne", "{names} are read by Bogey as one team, {name}", {
            names: list(variants.map((each) => `"${each}"`)),
            name: commonest(spellings) ?? "",
          }),
        });
      }
    }
    if (names.length <= 1) {
      const lone = members.length === 1 ? people[members[0] ?? -1] : undefined;
      if (lone && !names.length) continue;
      const name =
        names[0] ??
        say("roster.defaultTeamName", "{name}'s team", {
          name: who(
            members.toSorted((a, b) => (people[a]?.line ?? 0) - (people[b]?.line ?? 0))[0] ?? -1,
          ),
        });
      if (!names.length)
        notes.push({
          message: say(
            "roster.noTeamName",
            '{people} named each other but no team, so they\'re "{name}"',
            { people: list(members.map(who)), name },
          ),
        });
      teams.push({ members, name, options: [], asking: false });
      continue;
    }
    const key = `name:${[...distinct.keys()].toSorted().join("|")}`;
    const counts = new Map(
      names.map((name) => [
        name,
        spellings.filter((each) => teamKey(each) === teamKey(name)).length,
      ]),
    );
    const suggested =
      names.toSorted(
        (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || b.length - a.length,
      )[0] ??
      names[0] ??
      "";
    conflicts.push({
      key,
      kind: "name",
      title: say(
        "roster.namesDiffer",
        "{people} name each other as teammates but call the team {names}",
        { people: list(members.map(who)), names: list(names.map((name) => `"${name}"`)) },
      ),
      evidence: members
        .map((index) => people[index])
        .filter((person) => person !== undefined)
        .map((person) => {
          const values = {
            line: person.line,
            name: label(person),
            team: person.team ?? "",
            mates: list(person.teammates.map((ref) => ref.text)),
          };
          if (person.teammates.length) {
            return person.team
              ? say("roster.wroteWith", 'Line {line}: {name} wrote "{team}", with {mates}', values)
              : say(
                  "roster.wroteNoneWith",
                  "Line {line}: {name} wrote no team name, with {mates}",
                  values,
                );
          }
          return person.team
            ? say("roster.wrote", 'Line {line}: {name} wrote "{team}"', values)
            : say("roster.wroteNone", "Line {line}: {name} wrote no team name", values);
        }),
      options: [
        ...names.map((name) => ({
          id: `use:${name}`,
          label: say("roster.callIt", "Call it {name}", { name }),
          description: say("roster.wroteIt", "{count} wrote it", { count: counts.get(name) ?? 0 }),
        })),
        {
          id: "separate",
          label: say("roster.separate", "Keep them as separate teams"),
          description: say("roster.separateHelp", "Each person stays on the name they wrote"),
        },
        {
          id: "ask",
          label: say("roster.ask", "Ask them when they sign in"),
          description: say("roster.askHelp", "Each picks one of these names"),
        },
      ],
      suggested: `use:${suggested}`,
    });
    const choice = resolutions[key] ?? `use:${suggested}`;
    if (choice === "separate") {
      for (const name of names) {
        const own = members.filter((index) => teamKey(people[index]?.team ?? "") === teamKey(name));
        teams.push({ members: own, name, options: [], asking: false });
      }
      const nameless = members.filter((index) => !people[index]?.team);
      for (const index of nameless) {
        const by = claimedBy.get(index)?.find((each) => people[each]?.team);
        const team = teams.find((each) => by !== undefined && each.members.includes(by));
        team?.members.push(index);
      }
    } else if (choice === "ask") {
      teams.push({ members, name: undefined, options: names, asking: true });
    } else {
      teams.push({ members, name: choice.slice(4) || suggested, options: [], asking: false });
    }
  }

  const existing = catalog.teams;
  const named = teams.filter((team): team is Team & { name: string } => team.name !== undefined);
  for (let i = 0; i < named.length; i++) {
    const team = named[i];
    if (!team) continue;
    const already = existing.find((name) => teamKey(name) === teamKey(team.name));
    if (already) {
      team.name = already;
      continue;
    }
    const near = existing.find((name) => similarTeams(name, team.name));
    if (near) {
      const key = `similar:${teamKey(team.name)}|${teamKey(near)}`;
      conflicts.push({
        key,
        kind: "similar",
        title: say(
          "roster.looksLikeExisting",
          '"{team}" looks like {near}, a team already in the event',
          {
            team: team.name,
            near,
          },
        ),
        evidence: [
          say("roster.wroteName", '{people} wrote "{team}"', {
            people: list(team.members.map(who)),
            team: team.name,
          }),
        ],
        options: [
          { id: "join", label: say("roster.putOn", "Put them on {team}", { team: near }) },
          {
            id: "separate",
            label: say("roster.newTeam", "Make a new team, {team}", { team: team.name }),
          },
          { id: "ask", label: say("roster.ask", "Ask them when they sign in") },
        ],
        suggested: "ask",
      });
      const choice = resolutions[key] ?? "ask";
      if (choice === "join") team.name = near;
      if (choice === "ask") {
        team.options = [near, team.name];
        team.asking = true;
      }
      continue;
    }
    for (let j = i + 1; j < named.length; j++) {
      const other = named[j];
      if (!other || other.members.length === 0 || !similarTeams(team.name, other.name)) continue;
      const unnumbered = (name: string) => name.replace(/ \(\d+\)$/, "");
      if (unnumbered(team.name) === unnumbered(other.name)) continue;
      const key = `similar:${[teamKey(team.name), teamKey(other.name)].toSorted().join("|")}`;
      const pair = [team.name, other.name];
      const suggested = commonest([
        ...team.members.map(() => team.name),
        ...other.members.map(() => other.name),
      ]);
      conflicts.push({
        key,
        kind: "similar",
        title: say("roster.looksSame", '"{a}" and "{b}" look like the same team', {
          a: team.name,
          b: other.name,
        }),
        evidence: [team, other].map((each) =>
          say("roster.wroteName", '{people} wrote "{team}"', {
            people: list(each.members.map(who)),
            team: each.name,
          }),
        ),
        options: [
          ...pair.map((name) => ({
            id: `use:${name}`,
            label: say("roster.oneTeamCalled", "One team, called {name}", { name }),
          })),
          { id: "separate", label: say("roster.different", "They're different teams") },
          { id: "ask", label: say("roster.ask", "Ask them when they sign in") },
        ],
        suggested: `use:${suggested ?? team.name}`,
      });
      const choice = resolutions[key] ?? `use:${suggested ?? team.name}`;
      if (choice.startsWith("use:")) {
        team.members.push(...other.members);
        other.members = [];
        team.name = choice.slice(4);
      } else if (choice === "ask") {
        for (const each of [team, other]) {
          each.options = pair;
          each.asking = true;
        }
      }
    }
  }

  const finalTeams = teams.filter((team) => team.members.length > 0);
  if (options.maxTeamSize) {
    for (const team of finalTeams) {
      if (team.members.length > options.maxTeamSize) {
        notes.push({
          message: say(
            "roster.tooBig",
            "{team} would have {count} members; the event allows {max}. Extra members are left off when it fills up",
            {
              team: team.name ?? say("roster.aTeam", "A team"),
              count: team.members.length,
              max: options.maxTeamSize,
            },
          ),
        });
      }
    }
  }

  const teamOf = new Map<number, Team>();
  for (const team of finalTeams) for (const index of team.members) teamOf.set(index, team);

  const unmatchedDivisions = new Set<string>();
  const unmatchedSessions = new Set<string>();
  const planned: PlannedPerson[] = people.map((person, index) => {
    const team = teamOf.get(index);
    const mapped = (kind: ColumnKind, value: string) =>
      table.columns.some(
        (column) =>
          column.kind === kind &&
          (person.cells.get(fold(column.header)) ?? "") === value &&
          mappingRule(options.rules ?? [], column.header, value) !== undefined,
      );
    const ownDivision =
      person.division && !mapped("division", person.division)
        ? matchDivision(person.division, catalog.divisions)?.id
        : undefined;
    const division = person.ruledDivision ?? ownDivision;
    if (
      person.division &&
      !division &&
      catalog.divisions.length &&
      !mapped("division", person.division)
    ) {
      unmatchedDivisions.add(person.division);
    }
    const sessions = [
      ...person.sessions.flatMap((value) => {
        if (mapped("session", value)) return [];
        const match = matchName(value, catalog.sessions);
        if (!match && catalog.sessions.length) unmatchedSessions.add(value);
        return match ? [match.id] : [];
      }),
      ...person.ruledSessions,
    ];
    const asking = person.mode === "asking" ? claimedTeam(index) : undefined;
    return {
      line: person.line,
      email: person.email,
      ...(person.name ? { name: person.name } : {}),
      ...(team?.name && !team.asking ? { team: team.name } : {}),
      ...(team?.asking ? { teamOptions: team.options } : asking ? { teamOptions: [asking] } : {}),
      ...(division ? { division } : {}),
      sessions: [...new Set(sessions)],
      ...(person.role ? { role: person.role } : {}),
      answers: person.answers,
      wantsTeam: person.mode === "placed",
    };
  });

  function claimedTeam(index: number): string | undefined {
    const by = claimedBy.get(index)?.[0];
    const team = by === undefined ? undefined : teamOf.get(by);
    return team?.name ?? (by === undefined ? undefined : people[by]?.team);
  }

  if (unmatchedDivisions.size) {
    notes.push({
      message: say("roster.noDivision", "No division matches {values}; add a rule to place them", {
        values: list([...unmatchedDivisions].map((each) => `"${each}"`)),
      }),
    });
  }
  if (unmatchedSessions.size) {
    notes.push({
      message:
        unmatchedSessions.size > 5
          ? say(
              "roster.noSessionMore",
              "No session on the agenda matches {values} and {more} more; add a rule to sign them up",
              {
                values: list([...unmatchedSessions].slice(0, 5).map((each) => `"${each}"`)),
                more: unmatchedSessions.size - 5,
              },
            )
          : say(
              "roster.noSession",
              "No session on the agenda matches {values}; add a rule to sign them up",
              {
                values: list([...unmatchedSessions].map((each) => `"${each}"`)),
              },
            ),
    });
  }

  return {
    table,
    people: planned,
    teams: finalTeams.map((team) => ({
      name: team.name ?? list(team.options.map((each) => `"${each}"`)),
      members: team.members.flatMap((index) => (people[index] ? [people[index].email] : [])),
      existing: team.name !== undefined && existing.some((name) => name === team.name),
      asking: team.asking,
    })),
    conflicts,
    notes,
    problems: read.problems,
  };
}

export function mappingRule(
  rules: Tuple<ImportRule>,
  column: string,
  value: string,
): ImportRule | undefined {
  const is = (condition: RuleCondition | undefined) =>
    condition?.operator === "is" &&
    fold(condition.column) === fold(column) &&
    fold(condition.value) === fold(value);
  return rules.find(
    (rule) =>
      rule.when.length === 1 &&
      is(rule.when[0]) &&
      (rule.then.kind === "division" || rule.then.kind === "session" || rule.then.kind === "skip"),
  );
}

export interface ValueToMap {
  column: string;
  kind: "division" | "session";
  value: string;
  count: number;
  matched?: string;
}

export function valuesToMap(table: RosterTable, catalog: RosterCatalog): ValueToMap[] {
  const out: ValueToMap[] = [];
  for (const column of table.columns) {
    if (column.kind !== "division" && column.kind !== "session") continue;
    const counts = new Map<string, number>();
    for (const row of table.rows) {
      const value = row.cells[column.index]?.trim() ?? "";
      if (value && !NOISE.test(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [value, count] of counts) {
      const matched =
        column.kind === "division"
          ? matchDivision(value, catalog.divisions)?.name
          : matchName(value, catalog.sessions)?.name;
      out.push({
        column: column.header,
        kind: column.kind,
        value,
        count,
        ...(matched ? { matched } : {}),
      });
    }
  }
  return out;
}
