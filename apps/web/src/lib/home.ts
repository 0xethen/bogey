import { createServerFn } from "@tanstack/react-start";
import { isOrgAdmin, type Session } from "@bogey/db/auth";
import { ok, toFailure, type DbResult } from "@bogey/db/errors";
import { requireId } from "@bogey/db/queries/validate";
import { createServerClient } from "@bogey/db/server";
import type { Json } from "@bogey/db/types";

// where "/" and the logo go; "default" is the instance home for instance admins, else All events
export type HomeChoice = "default" | "events" | "org" | "admin" | `event:${string}`;

export const HOME_PREFERENCE = { namespace: "core", key: "home" } as const;

export function isHomeChoice(raw: Json): raw is HomeChoice {
  return (
    raw === "default" ||
    raw === "events" ||
    raw === "org" ||
    raw === "admin" ||
    (typeof raw === "string" && /^event:[0-9a-f-]{36}$/.test(raw))
  );
}

export interface HomeTarget {
  choice: HomeChoice;
  slug: string | null;
}

export const homeTargetFn = createServerFn({ method: "GET" })
  .validator((orgId: unknown) => (orgId == null ? null : requireId(orgId, "orgId")))
  .handler(async ({ data: orgId }): Promise<DbResult<HomeTarget>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("user_preferences")
      .select("value")
      .eq("namespace", HOME_PREFERENCE.namespace)
      .eq("key", HOME_PREFERENCE.key)
      .maybeSingle();
    if (error) return toFailure(error, "loading your home page");
    const choice = data && isHomeChoice(data.value) ? data.value : "default";
    if (!choice.startsWith("event:") || !orgId) return ok({ choice, slug: null });

    const event = await supabase
      .from("events")
      .select("slug")
      .eq("id", choice.slice("event:".length))
      .eq("org_id", orgId)
      .maybeSingle();
    if (event.error) return toFailure(event.error, "loading your home page");
    return ok({ choice, slug: event.data?.slug ?? null });
  });

export type HomePath =
  | { to: "/admin" }
  | { to: "/org" }
  | { to: "/events" }
  | { to: "/events/$slug"; params: { slug: string } };

// a pick the person can no longer use (not an admin any more, left the event) falls back to the default
export function homePath(target: HomeTarget | null, session: Session): HomePath {
  const fallback: HomePath = session.platformAdmin ? { to: "/admin" } : { to: "/events" };
  if (!target) return fallback;
  if (target.choice === "events") return { to: "/events" };
  if (target.choice === "org") return isOrgAdmin(session) ? { to: "/org" } : fallback;
  if (target.choice === "admin") return fallback;
  if (target.slug) return { to: "/events/$slug", params: { slug: target.slug } };
  return fallback;
}
