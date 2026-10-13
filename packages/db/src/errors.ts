import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { PostgrestError } from "@supabase/supabase-js";
import { security } from "@bogey/config";

export const VERBOSE_ERRORS: boolean = import.meta.env.DEV || security.verboseErrors;

export type BogeyErrorCode =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable"
  | "unknown";

export interface BogeyError {
  code: BogeyErrorCode;
  message: string;
  retryable: boolean;
  detail?: string;
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: BogeyError };

export function ok<T>(data: T): DbResult<T> {
  return { ok: true, data };
}

export function fail(code: BogeyErrorCode, message: string, cause?: unknown): DbResult<never> {
  const error: BogeyError = { code, message, retryable: code === "unavailable" };
  if (VERBOSE_ERRORS && cause !== undefined) error.detail = describeCause(cause);
  return { ok: false, error };
}

export function describeCause(cause: unknown, context?: string): string {
  const lines: string[] = context ? [context] : [];
  if (cause instanceof Error) {
    lines.push(cause.stack ?? `${cause.name}: ${cause.message}`);
    if (cause.cause !== undefined) lines.push(`Caused by: ${describeCause(cause.cause)}`);
  } else if (cause && typeof cause === "object" && "message" in cause) {
    const pg = cause as Partial<PostgrestError>;
    lines.push(pg.code ? `[${pg.code}] ${pg.message}` : String(pg.message));
    if (pg.details) lines.push(`Details: ${pg.details}`);
    if (pg.hint) lines.push(`Hint: ${pg.hint}`);
  } else {
    lines.push(typeof cause === "string" ? cause : (JSON.stringify(cause) ?? String(cause)));
  }
  return lines.join("\n");
}

const SQLSTATE: Record<string, BogeyErrorCode> = {
  "42501": "forbidden",
  P0001: "invalid",
  P0002: "not_found",
  "23505": "conflict",
  "23503": "invalid",
  "23514": "invalid",
  "22023": "invalid",
  "23502": "invalid",
  PGRST116: "not_found",
  PGRST301: "forbidden",
};

const MESSAGES: Record<BogeyErrorCode, string> = {
  forbidden: "You don't have access to do that.",
  not_found: "That isn't available. It may have been removed.",
  conflict: "That's already been done.",
  invalid: "That change wasn't accepted. Check the details and try again.",
  unavailable: "We can't reach the server right now. Try again in a moment.",
  unknown: "An unknown error occurred. Try again in a moment.",
};

const INTERNAL =
  /violates|relation "|column "|constraint|syntax|permission denied|duplicate key|null value|invalid input/i;

export function userMessage(error: unknown, code: BogeyErrorCode): string {
  const message = (error as Partial<PostgrestError> | null)?.message;
  if (
    typeof message === "string" &&
    message.length > 0 &&
    message.length <= 200 &&
    code !== "unknown" &&
    code !== "unavailable" &&
    !INTERNAL.test(message)
  ) {
    return message.charAt(0).toUpperCase() + message.slice(1) + (/[.!?]$/.test(message) ? "" : ".");
  }
  return MESSAGES[code];
}

const MISSING_FROM_SCHEMA = new Set([
  "42P01",
  "42703",
  "42704",
  "42883",
  "PGRST200",
  "PGRST202",
  "PGRST204",
  "PGRST205",
]);

const REPAIR_HINT =
  "The database may be behind supabase/schemas. Try `vpr bogey db repair` (--dry-run shows what's missing first).";

export function toFailure(error: unknown, context: string): DbResult<never> {
  const code = classify(error);
  const hint = VERBOSE_ERRORS && isMissingFromSchema(error) ? REPAIR_HINT : null;
  console[code === "unknown" ? "error" : "warn"](
    `[bogey/db] ${context}:`,
    error,
    ...(hint ? [`\n${hint}`] : []),
  );
  const failure = fail(code, userMessage(error, code));
  if (VERBOSE_ERRORS && !failure.ok) {
    failure.error.detail = describeCause(error, context) + (hint ? `\n${hint}` : "");
  }
  return failure;
}

function isMissingFromSchema(error: unknown): boolean {
  const code = (error as Partial<PostgrestError> | null)?.code;
  return typeof code === "string" && MISSING_FROM_SCHEMA.has(code);
}

export function classify(error: unknown): BogeyErrorCode {
  if (!error) return "unknown";
  if (isAuthRetryableFetchError(error) || isFetchFailure(error)) return "unavailable";

  const code = (error as Partial<PostgrestError>).code;
  if (typeof code === "string" && code in SQLSTATE) return SQLSTATE[code]!;
  return "unknown";
}

function isFetchFailure(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network/i.test(error.message);
}

export function requestFailure(error: unknown): DbResult<never> {
  if (isFetchFailure(error)) return fail("unavailable", MESSAGES.unavailable, error);
  return fail(
    "invalid",
    error instanceof Error && error.message ? error.message : MESSAGES.unknown,
    error,
  );
}

export class BogeyRequestError extends Error {
  readonly code: BogeyErrorCode;
  readonly retryable: boolean;
  readonly detail: string | undefined;

  constructor(error: BogeyError) {
    super(error.message);
    this.name = "BogeyRequestError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.detail = error.detail;
  }
}

export function requestErrorCode(error: unknown): BogeyErrorCode | undefined {
  return error instanceof BogeyRequestError ? error.code : undefined;
}

export function errorCode(error: unknown): string {
  const code = requestErrorCode(error) ?? classify(error);
  return `BOGEY_ERR_${code.toUpperCase()}`;
}

export function unwrap<T>(result: DbResult<T>): T {
  if (result.ok) return result.data;
  throw new BogeyRequestError(result.error);
}

export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof BogeyRequestError) {
    if (!error.retryable) return false;
    if (error.code === "unavailable") return failureCount < 1;
  }
  return failureCount < 2;
}
