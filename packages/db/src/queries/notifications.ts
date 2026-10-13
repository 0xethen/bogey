import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { requireId } from "./validate.ts";

export type Notification = Pick<
  Tables<"notifications">,
  "id" | "kind" | "title" | "body_md" | "link" | "event_id" | "created_at" | "read_at"
>;

export interface NotificationFeed {
  items: Notification[];
  unread: number;
}

const LIST_SIZE = 30;

export const notificationsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<NotificationFeed>> => {
    const supabase = createServerClient();
    const [list, unread] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, kind, title, body_md, link, event_id, created_at, read_at")
        .order("created_at", { ascending: false })
        .limit(LIST_SIZE),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null),
    ]);
    const error = list.error ?? unread.error;
    if (error) return toFailure(error, "loading notifications");
    return ok({ items: list.data ?? [], unread: unread.count ?? 0 });
  },
);

export const notificationsQueryKey = ["notifications"] as const;

export const notificationsQueryOptions = () =>
  queryOptions({
    queryKey: notificationsQueryKey,
    queryFn: async () => unwrap(await notificationsFn()),
    retry: retryPolicy,
  });

export const markNotificationsReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown };
    return { id: raw.id === undefined ? null : requireId(raw.id, "id") };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "You need to be signed in.");
    const unread = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    const { error } = await (data.id ? unread.eq("id", data.id) : unread);
    if (error) return toFailure(error, "marking notifications read");
    return ok(null);
  });

export type NotificationChannels = {
  [kind: string]: { inApp?: boolean; email?: boolean } | undefined;
};
