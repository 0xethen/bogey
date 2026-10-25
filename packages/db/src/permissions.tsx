import { useSyncExternalStore } from "react";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { useRouteContext } from "@tanstack/react-router";
import { createServerClient } from "./server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "./errors.ts";
import { requireId } from "./queries/validate.ts";
import type { CorePermission, Enums } from "./types.ts";
import { resolveSettings } from "@bogey/config/settings";
import { TAG_REF, tagRef } from "@bogey/utils/keys";
import { VIEW_AS_COOKIE, viewAsCookie, type ViewAsRole } from "./view-as.ts";

export type EventRole = Enums<"event_role">;

// the core's permissions are read from supabase/schemas (`bogey types --schema`)
export { CORE_PERMISSIONS, type CorePermission } from "./types.ts";

export type Permission = CorePermission | (string & {});

export interface EventAccess {
  eventId: string;
  role: EventRole | null;
  orgAdmin: boolean;
  grants: Tuple<string>;
  roleKeys: Tuple<string>;
  matrix: Readonly<Record<string, Tuple<string>>>;
}

export function can(access: EventAccess | null | undefined, permission: Permission): boolean {
  if (!access) return false;
  if (access.orgAdmin || access.role === "organizer") return true;
  return access.grants.includes(permission);
}

const ATTENDANCE = ["people.checkin", "sessions.attendance"] as const;

export const getEventAccessFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<EventAccess>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const [event, member, roleGrants, matrix, orgRoles, checkin, tagGrants] = await Promise.all([
      supabase.from("events").select("org_id").eq("id", eventId).maybeSingle(),
      userId
        ? supabase
            .from("event_members")
            .select("role, status")
            .eq("event_id", eventId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      userId
        ? supabase
            .from("event_role_grants")
            .select("role_key")
            .eq("event_id", eventId)
            .eq("user_id", userId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("role_permissions").select("role_key, permission"),
      userId
        ? supabase.from("org_members").select("org_id, role").eq("user_id", userId)
        : Promise.resolve({ data: [], error: null }),
      supabase.rpc("settings_for", { p_namespaces: ["checkin", "tags"], p_event: eventId }),
      userId
        ? supabase
            .from("tag_holders")
            .select("tag_id, org_id, event_id, tags(permissions)")
            .eq("user_id", userId)
            .or(`event_id.is.null,event_id.eq.${eventId}`)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const error = event.error ?? member.error ?? roleGrants.error ?? matrix.error;
    if (error) return toFailure(error, "loading event access");

    const orgRole = orgRoles.data?.find((row) => row.org_id === event.data?.org_id)?.role;
    const orgAdmin = orgRole === "admin" || orgRole === "owner";

    const role = member.data?.status === "active" ? member.data.role : null;
    const roleKeys = (roleGrants.data ?? []).map((row) => row.role_key);
    const byRole: Record<string, string[]> = {};
    for (const row of matrix.data ?? []) (byRole[row.role_key] ??= []).push(row.permission);
    // who takes attendance is the event's checkin.takers, as private.holds_permission reads it
    const settings =
      checkin.data && typeof checkin.data === "object" && !Array.isArray(checkin.data)
        ? checkin.data
        : {};
    const checkinValue: unknown = settings.checkin;
    for (const taker of resolveSettings("checkin", checkinValue).takers ?? []) {
      if (TAG_REF.test(taker)) continue;
      (byRole[taker] ??= []).push(...ATTENDANCE);
    }

    const held = new Set<string>(role ? (byRole[role] ?? []) : []);
    for (const key of roleKeys) for (const permission of byRole[key] ?? []) held.add(permission);
    // tags add permissions on top of a role, as private.tags_grant does; event tags only while allowed
    const eventTags = resolveSettings("tags", settings.tags).eventTags;
    // checkin.takers can name tags too ("tag:<id>")
    const takers = new Set<string>(resolveSettings("checkin", checkinValue).takers ?? []);
    if (role) {
      for (const row of tagGrants.data ?? []) {
        if (row.org_id !== event.data?.org_id || (row.event_id && !eventTags)) continue;
        for (const permission of row.tags?.permissions ?? []) held.add(permission);
        if (takers.has(tagRef(row.tag_id)))
          for (const permission of ATTENDANCE) held.add(permission);
      }
    }

    return ok({ eventId, role, orgAdmin, grants: [...held], roleKeys, matrix: byRole });
  });

export const eventAccessQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-access", eventId] as const,
    queryFn: async () => unwrap(await getEventAccessFn({ data: eventId })),
    retry: retryPolicy,
    staleTime: 60_000,
  });

/** Why a plugin has closed the event to this participant (`<plugin>.<reason>`), or null. */
export const getEventGateFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string | null>> => {
    const { data, error } = await createServerClient().rpc("event_gate", { p_event: eventId });
    if (error) return toFailure(error, "checking whether the event is open to you");
    return ok(data ?? null);
  });

// never stale: the event route asks on every navigation, and the server is what decides
export const eventGateQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-gate", eventId] as const,
    queryFn: async () => unwrap(await getEventGateFn({ data: eventId })),
    retry: retryPolicy,
    staleTime: 0,
  });

export { VIEW_AS_ROLES, type ViewAsRole } from "./view-as.ts";

let previewCache: ViewAsRole | null = null;
const previewListeners = new Set<() => void>();
// the cookie is shared by every tab, so they all follow a change; browser only, since an open
// channel keeps the server process from exiting
const previewChannel =
  typeof window === "undefined" || typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(VIEW_AS_COOKIE);

if (typeof window !== "undefined") {
  previewCache = viewAsCookie();
  previewChannel?.addEventListener("message", () => {
    previewCache = viewAsCookie();
    notifyPreview();
  });
}

function notifyPreview() {
  for (const listener of [...previewListeners]) listener();
}

function subscribePreview(listener: () => void) {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function setViewAs(role: ViewAsRole | null): void {
  if (typeof document === "undefined") return;
  document.cookie = role
    ? `${VIEW_AS_COOKIE}=${role}; path=/; samesite=lax`
    : `${VIEW_AS_COOKIE}=; path=/; max-age=0; samesite=lax`;
  previewCache = role;
  notifyPreview();
  previewChannel?.postMessage(role);
}

/** Runs on every change of "view as", in this tab or another; returns the unsubscribe. */
export function onViewAsChange(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function useViewAs(): ViewAsRole | null {
  return useSyncExternalStore(
    subscribePreview,
    () => previewCache,
    () => null,
  );
}

export function previewAccess(access: EventAccess, previewing: ViewAsRole | null): EventAccess {
  if (!previewing) return access;
  const previewGrants = access.matrix[previewing] ?? [];
  return {
    ...access,
    role: previewing,
    orgAdmin: false,
    grants: previewGrants.filter((permission) => can(access, permission)),
    roleKeys: [],
  };
}

function hasAccess(value: unknown): value is { access: EventAccess } {
  return typeof value === "object" && value !== null && "access" in value;
}

export function useEventAccess(): EventAccess | null {
  const context = useRouteContext({ strict: false });
  const previewing = useViewAs();
  return hasAccess(context) ? previewAccess(context.access, previewing) : null;
}

export function useCan(permission: Permission): boolean {
  return can(useEventAccess(), permission);
}
