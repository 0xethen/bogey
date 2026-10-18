import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Tables } from "../types.ts";
import {
  optionalId,
  optionalText,
  requireId,
  requireOneOf,
  requireSlug,
  requireText,
} from "./validate.ts";

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

const AUDIENCES = ["members", "public"] as const satisfies Tuple<Enums<"page_audience">>;
const WINDOW_KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/;

interface PageInput {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  window_key: string | null;
  audience: Enums<"page_audience">;
}

/** Replaces the event's pages with these, in this order: ones left out are deleted. */
export const savePagesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; pages?: unknown };
    if (!Array.isArray(raw.pages) || raw.pages.length > 50) {
      throw new Error("pages must be a list of up to 50");
    }
    const pages = raw.pages.map((item: unknown): PageInput => {
      const each = (item ?? {}) as Record<string, unknown>;
      const window = optionalText(each.window_key, "Window", 80);
      if (window !== null && !WINDOW_KEY.test(window)) throw new Error("Unknown window");
      return {
        id: optionalId(each.id === "" ? undefined : each.id, "id") ?? "",
        slug: requireSlug(each.slug, "Address"),
        title: requireText(each.title, "Title", 120),
        body_md: optionalText(each.body_md, "Page", 100_000) ?? "",
        window_key: window,
        audience: requireOneOf(each.audience, AUDIENCES, "Who can see it"),
      };
    });
    return { eventId: requireId(raw.eventId, "eventId"), pages };
  })
  .handler(async ({ data }): Promise<DbResult<EventPage[]>> => {
    const supabase = createServerClient();
    const { data: existing, error: loadError } = await supabase
      .from("event_pages")
      .select("id")
      .eq("event_id", data.eventId);
    if (loadError) return toFailure(loadError, "loading the event's pages");

    const kept = new Set(data.pages.flatMap((page) => page.id || []));
    const removed = existing.map((row) => row.id).filter((id) => !kept.has(id));
    if (removed.length) {
      const { error } = await supabase.from("event_pages").delete().in("id", removed);
      if (error) return toFailure(error, "removing pages");
    }
    const rows = data.pages.map((page, sort) => ({
      ...(page.id ? { id: page.id } : {}),
      event_id: data.eventId,
      slug: page.slug,
      title: page.title,
      body_md: page.body_md,
      window_key: page.window_key,
      audience: page.audience,
      sort,
    }));
    const updates = rows.filter((row) => "id" in row);
    if (updates.length) {
      // two pages trading addresses would collide on (event_id, slug), so park them first
      const { error } = await supabase.from("event_pages").upsert(
        updates.map((row) => ({
          ...row,
          slug: `${row.slug.slice(0, 55)}-${crypto.randomUUID().slice(0, 8)}`,
        })),
      );
      if (error) return toFailure(error, "saving pages");
      const { error: slugError } = await supabase.from("event_pages").upsert(updates);
      if (slugError) return toFailure(slugError, "saving pages");
    }
    const inserts = rows.filter((row) => !("id" in row));
    if (inserts.length) {
      const { error } = await supabase.from("event_pages").insert(inserts);
      if (error) return toFailure(error, "adding pages");
    }
    return eventPagesFn({ data: data.eventId });
  });
