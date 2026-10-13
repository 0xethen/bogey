import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "@bogey/db/server";
import { fail, ok, type DbResult } from "@bogey/db/errors";
import { networkAddress } from "@bogey/config/settings";
import { collapseRanges } from "@bogey/utils/network";

export const ASN = /^AS(\d{1,10})$/i;

const MAX_PREFIXES = 256;

export const resolveAsnFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const match = typeof input === "string" ? ASN.exec(input.trim()) : null;
    if (!match) throw new Error("Use an AS number like AS46830");
    return match[1]!;
  })
  .handler(async ({ data: number }): Promise<DbResult<string[]>> => {
    const { data: user } = await createServerClient().auth.getUser();
    if (!user.user) return fail("forbidden", "Sign in to look up networks.");

    let body: unknown;
    try {
      const response = await fetch(
        `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${number}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) return fail("unavailable", "The network lookup didn't answer. Try again.");
      body = await response.json();
    } catch {
      return fail("unavailable", "The network lookup didn't answer. Try again.");
    }

    const prefixes = announcedPrefixes(body).filter(
      (prefix) => networkAddress.safeParse(prefix).success,
    );
    if (prefixes.length === 0) {
      return fail("not_found", `AS${number} doesn't announce any networks.`);
    }
    const collapsed = collapseRanges(prefixes);
    if (collapsed.length > MAX_PREFIXES) {
      return fail("invalid", `AS${number} is too large to allow (${collapsed.length} ranges).`);
    }
    return ok(collapsed);
  });

function announcedPrefixes(body: unknown): string[] {
  if (typeof body !== "object" || body === null || !("data" in body)) return [];
  const { data } = body;
  if (typeof data !== "object" || data === null || !("prefixes" in data)) return [];
  const { prefixes } = data;
  if (!Array.isArray(prefixes)) return [];
  return prefixes.flatMap((entry: unknown) =>
    typeof entry === "object" &&
    entry !== null &&
    "prefix" in entry &&
    typeof entry.prefix === "string"
      ? [entry.prefix]
      : [],
  );
}
