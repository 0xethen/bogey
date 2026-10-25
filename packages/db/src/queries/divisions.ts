import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { optionalId, optionalText, requireId, requireText } from "./validate.ts";

export type Division = Tables<"divisions">;

export const eventDivisionsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Division[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("divisions")
      .select("*")
      .eq("event_id", eventId)
      .order("sort")
      .order("name");
    if (error) return toFailure(error, "loading divisions");
    return ok(data);
  });

export const eventDivisionsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["divisions", eventId] as const,
    queryFn: async () => unwrap(await eventDivisionsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const myDivisionFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string | null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");
    const { data, error } = await supabase
      .from("event_members")
      .select("division_id")
      .eq("event_id", eventId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error) return toFailure(error, "loading your division");
    return ok(data?.division_id ?? null);
  });

export const myDivisionQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["divisions", eventId, "mine"] as const,
    queryFn: async () => unwrap(await myDivisionFn({ data: eventId })),
    retry: retryPolicy,
  });

export interface DivisionInput {
  id: string;
  name: string;
  description: string;
  selectable: boolean;
  switchable: boolean;
  visible: boolean;
}

export const saveDivisionsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; divisions?: unknown };
    if (!Array.isArray(raw.divisions) || raw.divisions.length > 50) {
      throw new Error("divisions must be a list of up to 50");
    }
    const divisions = raw.divisions.map((item: unknown): DivisionInput => {
      const each = (item ?? {}) as Record<string, unknown>;
      return {
        id: optionalId(each.id === "" ? undefined : each.id, "id") ?? "",
        name: requireText(each.name, "Division name", 60),
        description: optionalText(each.description, "Description", 300) ?? "",
        selectable: each.selectable === true,
        switchable: each.switchable === true,
        visible: each.visible === true,
      };
    });
    return { eventId: requireId(raw.eventId, "eventId"), divisions };
  })
  .handler(async ({ data }): Promise<DbResult<Division[]>> => {
    const supabase = createServerClient();
    const { data: existing, error: loadError } = await supabase
      .from("divisions")
      .select("id")
      .eq("event_id", data.eventId);
    if (loadError) return toFailure(loadError, "loading divisions");

    const kept = new Set(data.divisions.flatMap((division) => division.id || []));
    const removed = existing.map((row) => row.id).filter((id) => !kept.has(id));
    if (removed.length) {
      const { error } = await supabase.from("divisions").delete().in("id", removed);
      if (error) return toFailure(error, "removing divisions");
    }
    const rows = data.divisions.map((division, sort) => ({
      ...(division.id ? { id: division.id } : {}),
      event_id: data.eventId,
      name: division.name,
      description: division.description || null,
      selectable: division.selectable,
      switchable: division.switchable,
      visible: division.visible,
      sort,
    }));
    const updates = rows.filter((row) => "id" in row);
    if (updates.length) {
      const { error } = await supabase.from("divisions").upsert(
        updates.map((row) => ({
          ...row,
          name: `${row.name.slice(0, 40)} ${crypto.randomUUID().slice(0, 8)}`,
        })),
      );
      if (error) return toFailure(error, "saving divisions");
      const { error: renameError } = await supabase.from("divisions").upsert(updates);
      if (renameError) return toFailure(renameError, "saving divisions");
    }
    const inserts = rows.filter((row) => !("id" in row));
    if (inserts.length) {
      const { error } = await supabase.from("divisions").insert(inserts);
      if (error) return toFailure(error, "adding divisions");
    }
    return eventDivisionsFn({ data: data.eventId });
  });

export const chooseDivisionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; divisionId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      divisionId: requireId(raw.divisionId, "divisionId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("choose_division", {
      p_event: data.eventId,
      p_division: data.divisionId,
    });
    if (error) return toFailure(error, "choosing a division");
    return ok(null);
  });

export const chooseTeamDivisionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; divisionId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      divisionId: requireId(raw.divisionId, "divisionId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("choose_team_division", {
      p_event: data.eventId,
      p_division: data.divisionId,
    });
    if (error) return toFailure(error, "moving your team to the division");
    return ok(null);
  });

export const setDivisionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; userId?: unknown; divisionId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId: requireId(raw.userId, "userId"),
      divisionId: optionalId(raw.divisionId, "divisionId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_division", {
      p_event: data.eventId,
      p_user: data.userId,
      p_division: data.divisionId,
    });
    if (error) return toFailure(error, "moving them to the division");
    return ok(null);
  });
