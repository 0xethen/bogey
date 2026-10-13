import { createServerClient } from "../server.ts";
import { requireId, requireOneOf } from "./validate.ts";

export function ownScope(raw: { scope?: unknown; orgId?: unknown; eventId?: unknown }) {
  const scope = requireOneOf(raw.scope, ["instance", "org", "event"] as const, "scope");
  return {
    scope,
    orgId: scope === "org" ? requireId(raw.orgId, "orgId") : null,
    eventId: scope === "event" ? requireId(raw.eventId, "eventId") : null,
  };
}

export async function readOwnSettings(scope: ReturnType<typeof ownScope>, namespace: string) {
  const supabase = createServerClient();
  let query = supabase
    .from("settings")
    .select("value, locked_keys")
    .eq("scope", scope.scope)
    .eq("namespace", namespace);
  query = scope.orgId ? query.eq("org_id", scope.orgId) : query.is("org_id", null);
  query = scope.eventId ? query.eq("event_id", scope.eventId) : query.is("event_id", null);
  return query.maybeSingle();
}
