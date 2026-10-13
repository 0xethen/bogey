import { sayEnglish, type Say } from "./messages.ts";

export const FIELD_KINDS = [
  "text",
  "longtext",
  "select",
  "multiselect",
  "boolean",
  "email",
  "url",
  "phone",
  "date",
  "number",
  "consent",
  "file",
] as const;

export type FormFieldKind = (typeof FIELD_KINDS)[number];

export type ShowWhen =
  | { field: string; in: Tuple<string | boolean> }
  | { field: string; ageUnder: number };

export interface FormField {
  key: string;
  label: string;
  kind: FormFieldKind;
  required: boolean;
  options?: string[];
  help?: string;
  text?: string;
  min?: number;
  max?: number;
  showWhen?: ShowWhen;
}

export interface FileAnswer {
  path: string;
  name: string;
  size: number;
  type: string;
}

export interface ConsentAnswer {
  accepted: true;
  at?: string;
  textHash?: string;
}

export type Answer = string | boolean | number | string[] | FileAnswer | ConsentAnswer;
export type Answers = { [key: string]: Answer };

export const MAX_TEXT = 500;
export const MAX_LONGTEXT = 5000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PHONE = /^\+?[0-9 ()\-.]{6,24}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFileAnswer(value: unknown): value is FileAnswer {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  );
}

export function readFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown): FormField[] => {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.label !== "string") {
      return [];
    }
    const kind = FIELD_KINDS.find((candidate) => candidate === entry.kind) ?? "text";
    const when = entry.showWhen;
    const showWhen: ShowWhen | undefined =
      isRecord(when) && typeof when.field === "string"
        ? typeof when.ageUnder === "number"
          ? { field: when.field, ageUnder: when.ageUnder }
          : Array.isArray(when.in)
            ? {
                field: when.field,
                in: when.in.filter(
                  (value): value is string | boolean =>
                    typeof value === "string" || typeof value === "boolean",
                ),
              }
            : undefined
        : undefined;
    return [
      {
        key: entry.key,
        label: entry.label,
        kind,
        required: entry.required === true,
        ...(Array.isArray(entry.options)
          ? {
              options: entry.options.filter(
                (option): option is string => typeof option === "string",
              ),
            }
          : {}),
        ...(typeof entry.help === "string" ? { help: entry.help } : {}),
        ...(typeof entry.text === "string" ? { text: entry.text } : {}),
        ...(typeof entry.min === "number" ? { min: entry.min } : {}),
        ...(typeof entry.max === "number" ? { max: entry.max } : {}),
        ...(showWhen ? { showWhen } : {}),
      },
    ];
  });
}

export function ageOn(birth: string, on: Date): number | null {
  const parts = DATE.exec(birth);
  if (!parts) return null;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  let age = on.getUTCFullYear() - year;
  const beforeBirthday =
    on.getUTCMonth() < month - 1 || (on.getUTCMonth() === month - 1 && on.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

function conditionHolds(when: ShowWhen, answer: Answer | undefined, on: Date): boolean {
  if ("ageUnder" in when) {
    const age = typeof answer === "string" ? ageOn(answer, on) : null;
    return age !== null && age < when.ageUnder;
  }
  if (typeof answer === "string" || typeof answer === "boolean") return when.in.includes(answer);
  if (Array.isArray(answer)) return answer.some((value) => when.in.includes(value));
  return false;
}

export function shownFields(
  fields: Tuple<FormField>,
  answers: Readonly<Answers>,
  on: Date,
): FormField[] {
  const shown = new Set<string>();
  const out: FormField[] = [];
  for (const field of fields) {
    const when = field.showWhen;
    if (when && !(shown.has(when.field) && conditionHolds(when, answers[when.field], on))) continue;
    shown.add(field.key);
    out.push(field);
  }
  return out;
}

export function answerProblem(
  field: FormField,
  answer: Answer | undefined,
  say: Say = sayEnglish,
): string | null {
  const label = field.label;
  const blank =
    answer === undefined ||
    answer === "" ||
    (Array.isArray(answer) && answer.length === 0) ||
    (field.kind === "boolean" && answer === false) ||
    (field.kind === "consent" && !(isRecord(answer) && answer.accepted === true));
  if (blank) {
    if (!field.required) return null;
    return field.kind === "boolean" || field.kind === "consent"
      ? say("regAnswer.check", "Check {label} to continue", { label })
      : say("answer.required", "{label} is required", { label });
  }
  switch (field.kind) {
    case "text":
      return typeof answer === "string" && answer.length <= MAX_TEXT
        ? null
        : say("answer.tooLong", "Keep {label} under {max} characters", { label, max: MAX_TEXT });
    case "longtext":
      return typeof answer === "string" && answer.length <= MAX_LONGTEXT
        ? null
        : say("answer.tooLong", "Keep {label} under {max} characters", {
            label,
            max: MAX_LONGTEXT,
          });
    case "email":
      return typeof answer === "string" && answer.length <= 254 && EMAIL.test(answer)
        ? null
        : say("regAnswer.email", "{label} should be an email address", { label });
    case "url":
      return typeof answer === "string" && answer.length <= 2000 && /^https?:\/\/\S+$/.test(answer)
        ? null
        : say("regAnswer.url", "{label} should be a full http(s) link", { label });
    case "phone":
      return typeof answer === "string" &&
        PHONE.test(answer) &&
        (answer.match(/\d/g)?.length ?? 0) >= 6
        ? null
        : say("regAnswer.phone", "{label} should be a phone number", { label });
    case "select":
      return typeof answer === "string" && (field.options ?? []).includes(answer)
        ? null
        : say("answer.option", "Choose one of the options for {label}", { label });
    case "multiselect":
      return Array.isArray(answer) &&
        answer.every((value) => typeof value === "string" && (field.options ?? []).includes(value))
        ? null
        : say("regAnswer.options", "Choose from the options for {label}", { label });
    case "boolean":
      return typeof answer === "boolean"
        ? null
        : say("regAnswer.yesNo", "{label} should be yes or no", { label });
    case "date":
      return typeof answer === "string" && ageOn(answer, new Date(0)) !== null
        ? null
        : say("regAnswer.date", "{label} should be a date", { label });
    case "number": {
      if (typeof answer !== "number" || !Number.isFinite(answer))
        return say("regAnswer.number", "{label} should be a number", { label });
      if (field.min !== undefined && answer < field.min) {
        return say("regAnswer.min", "{label} is at least {min}", { label, min: field.min });
      }
      if (field.max !== undefined && answer > field.max) {
        return say("regAnswer.max", "{label} is at most {max}", { label, max: field.max });
      }
      return null;
    }
    case "consent":
      return null;
    case "file":
      return isFileAnswer(answer) ? null : say("regAnswer.file", "{label} needs a file", { label });
  }
}

export function checkAnswers(
  fields: Tuple<FormField>,
  answers: Readonly<Answers>,
  on: Date,
  say: Say = sayEnglish,
): { problems: { [key: string]: string }; answers: Answers } {
  const problems: { [key: string]: string } = {};
  const kept: Answers = {};
  for (const field of shownFields(fields, answers, on)) {
    const answer = answers[field.key];
    const problem = answerProblem(field, answer, say);
    if (problem) problems[field.key] = problem;
    else if (answer !== undefined && answer !== "") kept[field.key] = answer;
  }
  return { problems, answers: kept };
}

export function fieldsProblem(fields: Tuple<FormField>): string | null {
  const earlier = new Map<string, FormFieldKind>();
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(field.key))
      return `"${field.key}" isn't a valid question key`;
    if (earlier.has(field.key)) return `Two questions use the key "${field.key}"`;
    if (
      (field.kind === "select" || field.kind === "multiselect") &&
      (field.options ?? []).length === 0
    ) {
      return `${field.label}: add at least one option`;
    }
    if (field.kind === "consent" && !field.text?.trim()) {
      return `${field.label}: write what people agree to`;
    }
    if (field.showWhen) {
      const target = earlier.get(field.showWhen.field);
      if (!target) return `${field.label}: it can only depend on a question above it`;
      if ("ageUnder" in field.showWhen && target !== "date") {
        return `${field.label}: an age condition needs a date question`;
      }
    }
    earlier.set(field.key, field.kind);
  }
  return null;
}
