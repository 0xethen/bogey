import { SLUG } from "@bogey/utils/keys";

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
