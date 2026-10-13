import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { requireId } from "./validate.ts";

export type EventPage = Tables<"event_pages">;

export const eventPagesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<EventPage[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("event_pages")
      .select("*")
      .eq("event_id", eventId)
      .order("sort");
    if (error) return toFailure(error, "loading the event's pages");
    return ok(data ?? []);
  });

export const eventPagesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-pages", eventId] as const,
    queryFn: async () => unwrap(await eventPagesFn({ data: eventId })),
    retry: retryPolicy,
  });
