import type { RosterRole } from "./roster.ts";
import { sayEnglish, type Say } from "./messages.ts";

export const RULE_OPERATORS = [
  "is",
  "is not",
  "contains",
  "starts with",
  "ends with",
  "matches",
  "is empty",
  "is not empty",
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const VALUELESS: ReadonlySet<RuleOperator> = new Set(["is empty", "is not empty"]);

export interface RuleCondition {
  column: string;
  operator: RuleOperator;
  value: string;
}

export type RuleAction =
  | { kind: "division"; target: string }
  | { kind: "session"; target: string }
  | { kind: "team"; target: string }
  | { kind: "role"; target: RosterRole }
  | { kind: "no team" }
  | { kind: "skip" };

export type RuleActionKind = RuleAction["kind"];

export const RULE_ACTIONS: Tuple<{ kind: RuleActionKind; label: string; target: boolean }> = [
  { kind: "division", label: "Put them in division", target: true },
  { kind: "session", label: "Sign them up for", target: true },
  { kind: "team", label: "Put them on team", target: true },
  { kind: "role", label: "Make them", target: true },
  { kind: "no team", label: "Leave them off any team", target: false },
  { kind: "skip", label: "Don't import them", target: false },
];

export interface ImportRule {
  id: string;
  when: RuleCondition[];
  then: RuleAction;
}

const ROLES: Tuple<RosterRole> = ["participant", "judge", "staff", "organizer"];

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function safeRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

export function conditionHolds(
  condition: RuleCondition,
  cells: ReadonlyMap<string, string>,
): boolean {
  const cell = fold(cells.get(fold(condition.column)) ?? "");
  const value = fold(condition.value);
  switch (condition.operator) {
    case "is":
      return cell === value;
    case "is not":
      return cell !== value;
    case "contains":
      return cell.includes(value);
    case "starts with":
      return cell.startsWith(value);
    case "ends with":
      return cell.endsWith(value);
    case "matches":
      return safeRegex(condition.value)?.test(cells.get(fold(condition.column)) ?? "") ?? false;
    case "is empty":
      return cell === "";
    case "is not empty":
      return cell !== "";
  }
}

export function ruleMatches(rule: ImportRule, cells: ReadonlyMap<string, string>): boolean {
  return rule.when.every((condition) => conditionHolds(condition, cells));
}

export function ruleProblem(
  rule: ImportRule,
  headers: Tuple<string>,
  targets: { divisions: Tuple<string>; sessions: Tuple<string> },
  say: Say = sayEnglish,
): string | null {
  const known = new Set(headers.map(fold));
  for (const condition of rule.when) {
    if (!known.has(fold(condition.column))) {
      return say("rules.noColumn", 'There\'s no column "{column}"', { column: condition.column });
    }
    if (condition.operator === "matches" && !safeRegex(condition.value)) {
      return say("rules.badPattern", '"{pattern}" isn\'t a pattern that can be matched', {
        pattern: condition.value,
      });
    }
  }
  const { then } = rule;
  if (
    then.kind === "division" &&
    !targets.divisions.some((name) => fold(name) === fold(then.target))
  ) {
    return say("rules.noDivision", 'The event has no division "{name}"', { name: then.target });
  }
  if (
    then.kind === "session" &&
    !targets.sessions.some((name) => fold(name) === fold(then.target))
  ) {
    return say("rules.noSession", 'The agenda has no session "{name}"', { name: then.target });
  }
  if (then.kind === "team" && !then.target.trim())
    return say("conflicts.nameTeam", "Name the team");
  return null;
}

const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function actionText(action: RuleAction): string {
  switch (action.kind) {
    case "division":
    case "session":
    case "team":
      return `${action.kind} ${quote(action.target)}`;
    case "role":
      return `role ${action.target}`;
    case "no team":
    case "skip":
      return action.kind;
  }
}

export function rulesToText(rules: Tuple<ImportRule>): string {
  return rules
    .map((rule) => {
      const when = rule.when.length
        ? rule.when
            .map((condition) =>
              VALUELESS.has(condition.operator)
                ? `[${condition.column}] ${condition.operator}`
                : condition.operator === "matches"
                  ? `[${condition.column}] matches /${condition.value}/`
                  : `[${condition.column}] ${condition.operator} ${quote(condition.value)}`,
            )
            .join(" and ")
        : "*";
      return `${when} -> ${actionText(rule.then)}`;
    })
    .join("\n");
}

export interface ParsedRules {
  rules: ImportRule[];
  problems: { line: number; message: string }[];
}

const OPERATORS_BY_LENGTH = [...RULE_OPERATORS].sort((a, b) => b.length - a.length);

class Reader {
  position = 0;
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }

  skipSpace() {
    while (/\s/.test(this.text[this.position] ?? "")) this.position++;
  }
  done() {
    this.skipSpace();
    return this.position >= this.text.length;
  }
  take(word: string): boolean {
    this.skipSpace();
    const next = this.text.slice(this.position, this.position + word.length);
    const after = this.text[this.position + word.length] ?? " ";
    if (next.toLowerCase() === word && !/[a-z]/i.test(after)) {
      this.position += word.length;
      return true;
    }
    return false;
  }
  takeSymbol(symbol: string): boolean {
    this.skipSpace();
    if (this.text.startsWith(symbol, this.position)) {
      this.position += symbol.length;
      return true;
    }
    return false;
  }
  delimited(open: string, close: string): string | null {
    this.skipSpace();
    if (this.text[this.position] !== open) return null;
    let out = "";
    for (let i = this.position + 1; i < this.text.length; i++) {
      const char = this.text[i] ?? "";
      if (char === "\\" && i + 1 < this.text.length) {
        const next = this.text[i + 1] ?? "";
        out += open === "/" && next !== "/" ? `\\${next}` : next;
        i++;
      } else if (char === close) {
        this.position = i + 1;
        return out;
      } else {
        out += char;
      }
    }
    return null;
  }
  word(): string | null {
    this.skipSpace();
    const match = /^[a-z]+/i.exec(this.text.slice(this.position));
    if (!match) return null;
    this.position += match[0].length;
    return match[0].toLowerCase();
  }
}

function readOperator(reader: Reader): RuleOperator | null {
  for (const candidate of OPERATORS_BY_LENGTH) {
    const at = reader.position;
    if (candidate.split(" ").every((word) => reader.take(word))) return candidate;
    reader.position = at;
  }
  return null;
}

function readCondition(reader: Reader, say: Say): RuleCondition | string {
  const column = reader.delimited("[", "]");
  if (column === null) {
    return say("rules.startColumn", 'Start with a column in brackets, like [Grade level], or "*"');
  }
  const operator = readOperator(reader);
  if (!operator) {
    return say("rules.howCompare", "After [{column}], say how to compare: {operators}", {
      column,
      operators: RULE_OPERATORS.join(", "),
    });
  }
  if (VALUELESS.has(operator)) return { column: column.trim(), operator, value: "" };
  const value =
    operator === "matches"
      ? (reader.delimited("/", "/") ?? reader.delimited('"', '"'))
      : reader.delimited('"', '"');
  if (value === null) {
    return operator === "matches"
      ? say("rules.givePattern", "Give [{column}] a /pattern/ to match", { column })
      : say("rules.quoteValue", "Put what [{column}] {operator} in quotes", { column, operator });
  }
  return { column: column.trim(), operator, value };
}

function readAction(reader: Reader, say: Say): RuleAction | string {
  const start = reader.position;
  if (reader.take("no") && reader.take("team")) return { kind: "no team" };
  reader.position = start;
  const kind = reader.word();
  if (kind === "skip") return { kind: "skip" };
  if (kind === "role") {
    const role = reader.word();
    const known = ROLES.find((each) => each === role);
    return known
      ? { kind: "role", target: known }
      : say("rules.roleIs", "A role is one of {roles}", { roles: ROLES.join(", ") });
  }
  if (kind === "division" || kind === "session" || kind === "team") {
    const target = reader.delimited('"', '"');
    if (target === null || !target.trim()) {
      return say(`rules.quoteName.${kind}`, "Put the {kind}'s name in quotes", { kind });
    }
    return { kind, target: target.trim() };
  }
  return say(
    "rules.whatToDo",
    'After "->", say what to do: division, session, team, role, no team or skip',
  );
}

export function parseRules(text: string, makeId: () => string, say: Say = sayEnglish): ParsedRules {
  const rules: ImportRule[] = [];
  const problems: ParsedRules["problems"] = [];
  text.split(/\r?\n/).forEach((source, index) => {
    const line = index + 1;
    if (!source.trim() || source.trim().startsWith("#")) return;
    const reader = new Reader(source);
    const when: RuleCondition[] = [];
    if (!reader.takeSymbol("*")) {
      for (;;) {
        const condition = readCondition(reader, say);
        if (typeof condition === "string") {
          problems.push({ line, message: condition });
          return;
        }
        when.push(condition);
        if (!reader.take("and")) break;
      }
    }
    if (!reader.takeSymbol("->") && !reader.takeSymbol("→")) {
      problems.push({
        line,
        message: say("rules.separate", 'Separate the condition from what to do with "->"'),
      });
      return;
    }
    const then = readAction(reader, say);
    if (typeof then === "string") {
      problems.push({ line, message: then });
      return;
    }
    if (!reader.done()) {
      problems.push({
        line,
        message: say("rules.unexpected", 'Unexpected "{text}"', {
          text: source.slice(reader.position).trim(),
        }),
      });
      return;
    }
    rules.push({ id: makeId(), when, then });
  });
  return { rules, problems };
}
