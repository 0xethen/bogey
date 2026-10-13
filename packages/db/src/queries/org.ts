import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { jsonRecord, type Enums, type Tables } from "../types.ts";
import { requireId, requireOneOf, requireSlug, requireText } from "./validate.ts";

export type OrgRole = Enums<"org_role">;
export type Event = Tables<"events">;

export interface OrgMember {
  userId: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
}

export const orgMembersFn = createServerFn({ method: "GET" })
  .validator((orgId: unknown) => requireId(orgId, "orgId"))
  .handler(async ({ data: orgId }): Promise<DbResult<OrgMember[]>> => {
    const supabase = createServerClient();
    const { data: members, error } = await supabase
      .from("org_members")
      .select("user_id, role, created_at")
      .eq("org_id", orgId)
      .order("created_at");
    if (error) return toFailure(error, "loading members");

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in(
        "id",
        (members ?? []).map((member) => member.user_id),
      );
    if (profileError) return toFailure(profileError, "loading members");
    const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));

    return ok(
      (members ?? []).map((member) => ({
        userId: member.user_id,
        name: names.get(member.user_id) ?? "Member",
        role: member.role,
        joinedAt: member.created_at,
      })),
    );
  });

export const orgMembersQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org-members", orgId] as const,
    queryFn: async () => unwrap(await orgMembersFn({ data: orgId })),
    retry: retryPolicy,
  });

const ROLES: Tuple<OrgRole> = ["member", "admin", "owner"];

export const setOrgRoleFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; userId?: unknown; role?: unknown };
    return {
      orgId: requireId(raw.orgId, "orgId"),
      userId: requireId(raw.userId, "userId"),
      role: requireOneOf(raw.role, ROLES, "role"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: updated, error } = await supabase
      .from("org_members")
      .update({ role: data.role })
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId)
      .select("user_id");
    if (error) return toFailure(error, "changing that role");
    if (!updated?.length) return fail("forbidden", "Only org admins can change roles.");
    return ok(null);
  });

export const removeOrgMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; userId?: unknown };
    return { orgId: requireId(raw.orgId, "orgId"), userId: requireId(raw.userId, "userId") };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: removed, error } = await supabase
      .from("org_members")
      .delete()
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId)
      .select("user_id");
    if (error) return toFailure(error, "removing that member");
    if (!removed?.length) return fail("forbidden", "Only org admins can remove members.");
    return ok(null);
  });

export const renameOrgFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; name?: unknown };
    return { orgId: requireId(raw.orgId, "orgId"), name: requireText(raw.name, "Name", 120) };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: updated, error } = await supabase
      .from("orgs")
      .update({ name: data.name })
      .eq("id", data.orgId)
      .select("id");
    if (error) return toFailure(error, "renaming the organization");
    if (!updated?.length) return fail("forbidden", "Only org admins can rename the organization.");
    return ok(null);
  });

const KINDS: Tuple<Enums<"event_kind">> = ["hackathon", "contest", "custom"];

export interface NewEvent {
  orgId: string;
  name: string;
  slug: string;
  kind: Enums<"event_kind">;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  teamSizeMin: number;
  teamSizeMax: number;
  plugin: string | null;
}

export const createEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown): NewEvent => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const size = (value: unknown, field: string) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        throw new Error(`${field} must be a whole number from 1 to 50`);
      }
      return value;
    };
    const time = (value: unknown) =>
      typeof value === "string" && value && !Number.isNaN(Date.parse(value)) ? value : null;
    return {
      orgId: requireId(raw.orgId, "orgId"),
      name: requireText(raw.name, "Name", 120),
      slug: requireSlug(raw.slug, "Web address"),
      kind: requireOneOf(raw.kind, KINDS, "Kind"),
      timezone: requireText(raw.timezone, "Timezone", 64),
      startsAt: time(raw.startsAt),
      endsAt: time(raw.endsAt),
      teamSizeMin: size(raw.teamSizeMin, "Smallest team"),
      teamSizeMax: size(raw.teamSizeMax, "Largest team"),
      plugin:
        typeof raw.plugin === "string" && /^[a-z0-9-]{3,32}$/.test(raw.plugin) ? raw.plugin : null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<Event>> => {
    const supabase = createServerClient();
    const { data: event, error } = await supabase.rpc("create_event", {
      p_org: data.orgId,
      p_slug: data.slug,
      p_name: data.name,
      p_kind: data.kind,
      p_timezone: data.timezone,
      ...(data.startsAt ? { p_starts_at: data.startsAt } : {}),
      ...(data.endsAt ? { p_ends_at: data.endsAt } : {}),
      p_team_size_min: data.teamSizeMin,
      p_team_size_max: data.teamSizeMax,
      ...(data.plugin ? { p_plugin: data.plugin } : {}),
    });
    if (error) {
      if (error.code === "23505")
        return fail("conflict", "Another event already uses that web address.");
      return toFailure(error, "creating the event");
    }
    return ok(event);
  });

export const CLONE_SECTIONS = [
  "details",
  "windows",
  "divisions",
  "tracks",
  "forms",
  "judging",
  "agenda",
  "pages",
  "homepage",
  "settings",
  "onboarding",
  "invites",
] as const;
export type CloneSection = (typeof CLONE_SECTIONS)[number];

export interface ClonedEvent {
  id: string;
  slug: string;
  reenter: string[];
}

function optionalTime(value: unknown): string | null {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value)) ? value : null;
}

export const cloneEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const sections = Array.isArray(raw.sections) ? raw.sections : [];
    return {
      sourceId: requireId(raw.sourceId, "sourceId"),
      name: requireText(raw.name, "Name", 120),
      slug: requireSlug(raw.slug, "Web address"),
      startsAt: optionalTime(raw.startsAt),
      endsAt: optionalTime(raw.endsAt),
      sections: sections.map((each) => requireOneOf(each, CLONE_SECTIONS, "Section")),
      template: raw.template === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<ClonedEvent>> => {
    const { data: cloned, error } = await createServerClient().rpc("clone_event", {
      p_source: data.sourceId,
      p_slug: data.slug,
      p_name: data.name,
      p_include: data.sections,
      p_template: data.template,
      ...(data.startsAt ? { p_starts_at: data.startsAt } : {}),
      ...(data.endsAt ? { p_ends_at: data.endsAt } : {}),
    });
    if (error) {
      if (error.code === "23505")
        return fail("conflict", "Another event already uses that web address.");
      return toFailure(error, "copying the event");
    }
    const result = jsonRecord(cloned);
    if (typeof result.id !== "string" || typeof result.slug !== "string") {
      return fail("unknown", "The copy didn't come back as expected.");
    }
    const reenter = Array.isArray(result.reenter)
      ? result.reenter.filter((name): name is string => typeof name === "string")
      : [];
    return ok({ id: result.id, slug: result.slug, reenter });
  });

export const eventSlugTakenFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; slug?: unknown; exceptEventId?: unknown };
    return {
      orgId: requireId(raw.orgId, "orgId"),
      slug: requireSlug(raw.slug, "Web address"),
      exceptEventId: raw.exceptEventId ? requireId(raw.exceptEventId, "exceptEventId") : null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<boolean>> => {
    const supabase = createServerClient();
    let query = supabase
      .from("events")
      .select("id")
      .eq("org_id", data.orgId)
      .eq("slug", data.slug)
      .limit(1);
    if (data.exceptEventId) query = query.neq("id", data.exceptEventId);
    const { data: rows, error } = await query;
    if (error) return toFailure(error, "checking the web address");
    return ok(rows.length > 0);
  });
