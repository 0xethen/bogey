import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums } from "../types.ts";
import { requireId, requireOneOf } from "./validate.ts";

export const CHECK_IN_METHODS = ["desk", "qr", "self"] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

export interface Badge {
  code: string;
  name: string;
  team: string | null;
  division: string | null;
}

export const myBadgeFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Badge | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("my_badge", { p_event: eventId });
    if (error) return toFailure(error, "loading your badge");
    const row = data[0];
    return ok(
      row ? { code: row.code, name: row.name, team: row.team, division: row.division } : null,
    );
  });

export const myBadgeQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-badge", eventId] as const,
    queryFn: async () => unwrap(await myBadgeFn({ data: eventId })),
    retry: retryPolicy,
  });

export function isCheckedIn(entry: { checkedInAt: string | null; checkedOutAt: string | null }) {
  return entry.checkedInAt !== null && entry.checkedOutAt === null;
}

export interface RosterEntry {
  userId: string;
  name: string;
  email: string;
  role: Enums<"event_role">;
  team: string | null;
  division: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  method: string | null;
}

export const checkinRosterFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<RosterEntry[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("checkin_roster", { p_event: eventId });
    if (error) return toFailure(error, "loading the roster");
    return ok(
      data.map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
        team: row.team,
        division: row.division,
        checkedInAt: row.checked_in_at,
        checkedOutAt: row.checked_out_at,
        method: row.method,
      })),
    );
  });

export const checkinRosterQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["checkin-roster", eventId] as const,
    queryFn: async () => unwrap(await checkinRosterFn({ data: eventId })),
    retry: retryPolicy,
    staleTime: 5_000,
  });

export interface CheckInResult {
  userId: string;
  name: string;
  already: boolean;
}

export const checkInFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      eventId?: unknown;
      userId?: unknown;
      code?: unknown;
      method?: unknown;
    };
    const code = typeof raw.code === "string" ? raw.code.trim().slice(0, 40) : "";
    const userId =
      typeof raw.userId === "string" && raw.userId ? requireId(raw.userId, "userId") : "";
    if (!code && !userId) throw new Error("Give a person or a code");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId,
      code,
      method: requireOneOf(raw.method ?? "desk", CHECK_IN_METHODS, "method"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<CheckInResult>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase.rpc("check_in", {
      p_event: data.eventId,
      p_method: data.method,
      ...(data.userId ? { p_user: data.userId } : {}),
      ...(data.code ? { p_code: data.code } : {}),
    });
    if (error) return toFailure(error, "checking in");
    const row = rows[0];
    if (!row) return toFailure(new Error("no result"), "checking in");
    return ok({ userId: row.user_id, name: row.name, already: row.already });
  });

export const undoCheckInFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; userId?: unknown; out?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId: requireId(raw.userId, "userId"),
      out: raw.out === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const args = { p_event: data.eventId, p_user: data.userId };
    const { error } = data.out
      ? await supabase.rpc("check_out", args)
      : await supabase.rpc("undo_check_in", args);
    if (error) return toFailure(error, data.out ? "checking out" : "undoing the check-in");
    return ok(null);
  });

export const walkInFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; email?: unknown; name?: unknown };
    if (typeof raw.email !== "string" || !raw.email.trim())
      throw new Error("Enter an email address");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      email: raw.email.trim().slice(0, 320),
      name: typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "",
    };
  })
  .handler(async ({ data }): Promise<DbResult<{ checkedIn: boolean }>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase.rpc("check_in_walk_in", {
      p_event: data.eventId,
      p_email: data.email,
      p_name: data.name,
    });
    if (error) return toFailure(error, "adding the walk-in");
    return ok({ checkedIn: rows[0]?.checked_in ?? false });
  });

export const venueCodeFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<{ code: string; secondsLeft: number }>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("venue_code", { p_event: eventId });
    if (error) return toFailure(error, "reading the venue code");
    const row = data[0];
    return ok({ code: row?.code ?? "", secondsLeft: row?.seconds_left ?? 0 });
  });

export const venueCodeQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["venue-code", eventId] as const,
    queryFn: async () => unwrap(await venueCodeFn({ data: eventId })),
    retry: retryPolicy,
    staleTime: 0,
  });

export interface BadgeSheetEntry extends Badge {
  userId: string;
  role: Enums<"event_role">;
}

export const badgeSheetFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<BadgeSheetEntry[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("badge_sheet", {
      p_event: eventId,
      p_roles: ["participant", "judge", "staff", "organizer"],
    });
    if (error) return toFailure(error, "loading badges");
    return ok(
      data.map((row) => ({
        userId: row.user_id,
        name: row.name,
        role: row.role,
        team: row.team,
        division: row.division,
        code: row.code,
      })),
    );
  });

export const badgeSheetQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["badge-sheet", eventId] as const,
    queryFn: async () => unwrap(await badgeSheetFn({ data: eventId })),
    retry: retryPolicy,
  });

export const myCheckInFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string | null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return ok(null);
    const { data, error } = await supabase
      .from("checkins")
      .select("checked_in_at, checked_out_at")
      .eq("event_id", eventId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error) return toFailure(error, "loading your check-in");
    return ok(data && !data.checked_out_at ? data.checked_in_at : null);
  });

export const myCheckInQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-check-in", eventId] as const,
    queryFn: async () => unwrap(await myCheckInFn({ data: eventId })),
    retry: retryPolicy,
  });
