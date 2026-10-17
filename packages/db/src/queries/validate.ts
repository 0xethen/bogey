import { SLUG } from "@bogey/utils/keys";
import type { Answers } from "@bogey/utils/registration-form";
import type { Json } from "../types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

export function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireId(value, field);
}

export function requireSlug(value: unknown, field: string): string {
  if (typeof value !== "string" || !SLUG.test(value) || value.length > 64) {
    throw new Error(`${field} must be a lowercase slug`);
  }
  return value;
}

export function requireText(value: unknown, field: string, max = 10_000): string {
  if (typeof value !== "string") throw new Error(`${field} is required`);

  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} can't be empty`);
  if (trimmed.length > max) throw new Error(`${field} is too long (max ${max} characters)`);

  return trimmed;
}

export function optionalText(value: unknown, field: string, max = 10_000): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, max);
}

export function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

export function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number`);
  }
  if (value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

export function optionalUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} must be a URL`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a full URL, starting with https://`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${field} must be an http(s) URL`);
  }

  return parsed.toString();
}

/** Registration answers from a request, each kept to the shapes a question can answer with. */
export function readAnswers(value: unknown): Answers {
  const answers: Answers = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return answers;
  for (const [key, answer] of Object.entries(value)) {
    if (typeof answer === "string") answers[key] = answer.slice(0, 5000);
    else if (typeof answer === "boolean" || typeof answer === "number") answers[key] = answer;
    else if (Array.isArray(answer)) {
      answers[key] = answer
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 50)
        .map((entry) => entry.slice(0, 200));
    } else if (answer && typeof answer === "object") {
      const entry: Record<string, unknown> = { ...answer };
      if (entry.accepted === true) answers[key] = { accepted: true };
      else if (
        typeof entry.path === "string" &&
        typeof entry.name === "string" &&
        typeof entry.size === "number" &&
        typeof entry.type === "string"
      ) {
        answers[key] = {
          path: entry.path.slice(0, 300),
          name: entry.name.slice(0, 200),
          size: entry.size,
          type: entry.type.slice(0, 100),
        };
      }
    }
  }
  return answers;
}

export function answersToJson(answers: Answers): Json {
  const json: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === "object" && !Array.isArray(value)) {
      json[key] =
        "accepted" in value
          ? { accepted: true }
          : { path: value.path, name: value.name, size: value.size, type: value.type };
    } else {
      json[key] = value;
    }
  }
  return json;
}
