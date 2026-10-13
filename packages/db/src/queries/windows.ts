import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { requireId } from "./validate.ts";

export type EventWindow = Tables<"event_windows">;

export const eventWindowsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<EventWindow[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("event_windows")
      .select("*")
      .eq("event_id", eventId);
    if (error) return toFailure(error, "loading the event schedule");
    return ok(data ?? []);
  });

export const eventWindowsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-windows", eventId] as const,
    queryFn: async () => unwrap(await eventWindowsFn({ data: eventId })),
    retry: retryPolicy,
    refetchInterval: 30_000,
  });

export function isWindowOpen(window: EventWindow | undefined, now: Date = new Date()): boolean {
  if (!window) return false;
  if (window.override) return window.override === "open";
  if (!window.opens_at && !window.closes_at) return false;
  if (window.opens_at && new Date(window.opens_at) > now) return false;
  if (window.closes_at && now >= new Date(window.closes_at)) return false;
  return true;
}

export function windowByKey(windows: Tuple<EventWindow>, key: string): EventWindow | undefined {
  return windows.find((window) => window.key === key);
}
