import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId } from "./validate.ts";
import { resolveSettings } from "@bogey/config/settings";
import type { Json } from "../types.ts";

function namespaceValue(resolved: Json | null, namespace: string): Json | undefined {
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved[namespace]
    : undefined;
}

export interface WelcomeNeeds {
  identity: boolean;
  division: boolean;
}

export const NOTHING_NEEDED: WelcomeNeeds = { identity: false, division: false };

export const isPending = (needs: WelcomeNeeds) => needs.identity || needs.division;

export const identitySetupPendingFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<WelcomeNeeds>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return ok(NOTHING_NEEDED);

    const [settings, member, divisions] = await Promise.all([
      supabase.rpc("settings_for", { p_namespaces: ["identity", "divisions"], p_event: eventId }),
      supabase
        .from("event_members")
        .select("role, identity_setup_at, division_id")
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("divisions")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("selectable", true),
    ]);
    const error = settings.error ?? member.error ?? divisions.error;
    if (error) return toFailure(error, "checking identity setup");
    if (member.data?.role !== "participant") return ok(NOTHING_NEEDED);

    const { enabled } = resolveSettings("identity", namespaceValue(settings.data, "identity"));
    const { askOnJoin } = resolveSettings("divisions", namespaceValue(settings.data, "divisions"));
    return ok({
      identity: enabled && !member.data.identity_setup_at,
      division: askOnJoin && !member.data.division_id && (divisions.count ?? 0) > 0,
    });
  });

export const identitySetupPendingQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["identity-setup", eventId] as const,
    queryFn: async () => unwrap(await identitySetupPendingFn({ data: eventId })),
    retry: retryPolicy,
  });

export const completeIdentitySetupFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("complete_identity_setup", { p_event: eventId });
    if (error) return toFailure(error, "finishing identity setup");
    return ok(null);
  });
