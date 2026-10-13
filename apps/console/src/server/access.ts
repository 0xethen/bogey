import { createHash, timingSafeEqual } from "node:crypto";

export const COOKIE = "bogey_console";

function token(): string | null {
  return process.env.CONSOLE_TOKEN || null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function cookieValue(): string | null {
  const secret = token();
  return secret ? digest(`cookie:${secret}`).toString("hex") : null;
}

export function sameSecret(given: string | null | undefined, expected: string | null): boolean {
  if (!given || !expected) return false;
  const a = digest(given);
  const b = digest(expected);
  return timingSafeEqual(a, b);
}

export function validToken(given: string | null): boolean {
  return sameSecret(given, token());
}

export function validCookie(given: string | null | undefined): boolean {
  return sameSecret(given, cookieValue());
}

export function loopbackHost(host: string | null): boolean {
  if (!host) return false;
  const port = process.env.CONSOLE_PORT ?? "3737";
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return loopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}
