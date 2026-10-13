import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { EventRole } from "../permissions.tsx";
import type { Tables } from "../types.ts";
import { requireId, requireSlug } from "./validate.ts";

export type Event = Tables<"events">;

export interface EventSummary extends Event {
  myRole: EventRole | null;
}

export const listEventsFn = createServerFn({ method: "GET" })
  .validator((orgId: unknown) => requireId(orgId, "orgId"))
  .handler(async ({ data: orgId }): Promise<DbResult<EventSummary[]>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();

    const [events, members] = await Promise.all([
      supabase
        .from("events")
        .select("*")
        .eq("org_id", orgId)
        .order("starts_at", { ascending: false, nullsFirst: false }),
      userData.user
        ? supabase
            .from("event_members")
            .select("event_id, role")
            .eq("user_id", userData.user.id)
            .eq("status", "active")
        : Promise.resolve({ data: [], error: null }),
    ]);

    const error = events.error ?? members.error;
    if (error) return toFailure(error, "loading events");

    const roles = new Map((members.data ?? []).map((row) => [row.event_id, row.role]));
    return ok(
      (events.data ?? []).map((event) => ({ ...event, myRole: roles.get(event.id) ?? null })),
    );
  });

export const eventsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["events", orgId] as const,
    queryFn: async () => unwrap(await listEventsFn({ data: orgId })),
    retry: retryPolicy,
  });

export const eventBySlugFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const { orgId, slug } = (input ?? {}) as { orgId?: unknown; slug?: unknown };
    return { orgId: requireId(orgId, "orgId"), slug: requireSlug(slug, "slug") };
  })
  .handler(async ({ data }): Promise<DbResult<Event>> => {
    const { data: event, error } = await createServerClient()
      .rpc("open_event", { p_org: data.orgId, p_slug: data.slug })
      .maybeSingle();

    if (error) return toFailure(error, "loading the event");
    if (!event) return fail("not_found", "There's no event at this address.");
    return ok(event);
  });

export const eventQueryOptions = (orgId: string, slug: string) =>
  queryOptions({
    queryKey: ["event", orgId, slug] as const,
    queryFn: async () => unwrap(await eventBySlugFn({ data: { orgId, slug } })),
    retry: retryPolicy,
  });
