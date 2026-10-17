import { useSyncExternalStore } from "react";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { useRouteContext } from "@tanstack/react-router";
import { createServerClient } from "./server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "./errors.ts";
import { requireId } from "./queries/validate.ts";
import type { Enums } from "./types.ts";

export type EventRole = Enums<"event_role">;

export type CorePermission =
  | "event.view"
  | "event.compete"
  | "event.manage"
  | "people.view"
  | "people.checkin"
  | "judging.score"
  | "sessions.attendance"
  | "clarifications.answer";

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

export const getEventAccessFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<EventAccess>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const [event, member, roleGrants, matrix, orgRoles] = await Promise.all([
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
    ]);

    const error = event.error ?? member.error ?? roleGrants.error ?? matrix.error;
    if (error) return toFailure(error, "loading event access");

    const orgRole = orgRoles.data?.find((row) => row.org_id === event.data?.org_id)?.role;
    const orgAdmin = orgRole === "admin" || orgRole === "owner";

    const role = member.data?.status === "active" ? member.data.role : null;
    const roleKeys = (roleGrants.data ?? []).map((row) => row.role_key);
    const byRole: Record<string, string[]> = {};
    for (const row of matrix.data ?? []) (byRole[row.role_key] ??= []).push(row.permission);

    const held = new Set<string>(role ? (byRole[role] ?? []) : []);
    for (const key of roleKeys) for (const permission of byRole[key] ?? []) held.add(permission);

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

export const VIEW_AS_ROLES = ["participant", "staff", "judge"] as const satisfies Tuple<EventRole>;
export type ViewAsRole = (typeof VIEW_AS_ROLES)[number];

const VIEW_AS_KEY = "bogey:view-as";
let previewCache: ViewAsRole | null = null;
const previewListeners = new Set<() => void>();

function readPreview(): ViewAsRole | null {
  if (typeof window === "undefined") return null;
  const stored = window.sessionStorage.getItem(VIEW_AS_KEY);
  return VIEW_AS_ROLES.find((role) => role === stored) ?? null;
}

if (typeof window !== "undefined") {
  previewCache = readPreview();
  window.addEventListener("storage", (event) => {
    if (event.key !== VIEW_AS_KEY) return;
    previewCache = readPreview();
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
  if (typeof window === "undefined") return;
  if (role) window.sessionStorage.setItem(VIEW_AS_KEY, role);
  else window.sessionStorage.removeItem(VIEW_AS_KEY);
  previewCache = role;
  notifyPreview();
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
