import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { eventDeletion } from "@bogey/config";
import { createAdminClient } from "../admin.ts";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Tables, TablesUpdate } from "../types.ts";
import {
  optionalText,
  optionalUrl,
  requireId,
  requireOneOf,
  requireSlug,
  requireText,
} from "./validate.ts";

type EventRole = Enums<"event_role">;
const EVENT_ROLES: Tuple<EventRole> = ["participant", "staff", "judge", "organizer"];

export interface ManageSummary {
  pending: number;
  participants: number;
  judges: number;
  staff: number;
  organizers: number;
  teams: number;
  submitted: number;
}

export const manageSummaryFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<ManageSummary>> => {
    const supabase = createServerClient();
    const count = (query: PromiseLike<{ count: number | null; error: unknown }>) => query;
    const members = (role: EventRole) =>
      count(
        supabase
          .from("event_members")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "active")
          .eq("role", role),
      );
    const results = await Promise.all([
      count(
        supabase
          .from("registrations")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "pending"),
      ),
      members("participant"),
      members("judge"),
      members("staff"),
      members("organizer"),
      count(
        supabase.from("teams").select("*", { count: "exact", head: true }).eq("event_id", eventId),
      ),
      count(
        supabase
          .from("submissions")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "submitted"),
      ),
    ]);
    const failed = results.find((result) => result.error);
    if (failed) return toFailure(failed.error, "loading the event summary");
    const [pending, participants, judges, staff, organizers, teams, submitted] = results.map(
      (r) => r.count ?? 0,
    );
    return ok({
      pending: pending!,
      participants: participants!,
      judges: judges!,
      staff: staff!,
      organizers: organizers!,
      teams: teams!,
      submitted: submitted!,
    });
  });

export const manageSummaryQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["manage-summary", eventId] as const,
    queryFn: async () => unwrap(await manageSummaryFn({ data: eventId })),
    retry: retryPolicy,
  });

const VISIBILITY: Tuple<Enums<"event_visibility">> = ["draft", "unlisted", "public"];

export const updateEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const changes: TablesUpdate<"events"> = {};
    if (raw.name !== undefined) changes.name = requireText(raw.name, "Name", 120);
    if (raw.slug !== undefined) changes.slug = requireSlug(raw.slug, "Web address");
    if (raw.shortName !== undefined)
      changes.short_name = optionalText(raw.shortName, "Short name", 32);
    if (raw.location !== undefined) changes.location = optionalText(raw.location, "Location", 200);
    if (raw.websiteUrl !== undefined) changes.website_url = optionalUrl(raw.websiteUrl, "Website");
    if (raw.timezone !== undefined) changes.timezone = requireText(raw.timezone, "Timezone", 64);
    if (raw.startsAt !== undefined)
      changes.starts_at = typeof raw.startsAt === "string" ? raw.startsAt : null;
    if (raw.endsAt !== undefined)
      changes.ends_at = typeof raw.endsAt === "string" ? raw.endsAt : null;
    if (raw.teamSizeMin !== undefined) changes.team_size_min = Number(raw.teamSizeMin);
    if (raw.teamSizeMax !== undefined) changes.team_size_max = Number(raw.teamSizeMax);
    if (raw.visibility !== undefined)
      changes.visibility = requireOneOf(raw.visibility, VISIBILITY, "Visibility");
    return { eventId: requireId(raw.eventId, "eventId"), changes };
  })
  .handler(async ({ data }): Promise<DbResult<Tables<"events">>> => {
    const supabase = createServerClient();
    const { data: event, error } = await supabase
      .from("events")
      .update(data.changes)
      .eq("id", data.eventId)
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23505")
        return fail("conflict", "Another event already uses that web address.");
      return toFailure(error, "saving the event");
    }
    if (!event) return fail("forbidden", "Only organizers can change this event.");
    return ok(event);
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      confirm: typeof raw.confirm === "string" ? raw.confirm.trim() : "",
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    if (!eventDeletion) return fail("forbidden", "This instance doesn't allow deleting events.");
    const { data: files, error } = await createServerClient().rpc("delete_event", {
      p_event: data.eventId,
      p_confirm: data.confirm,
    });
    if (error) return toFailure(error, "deleting the event");
    // the rows are gone; files go through the storage API so they leave the disk too
    const byBucket = new Map<string, string[]>();
    for (const file of (files ?? []) as { bucket: string; path: string }[]) {
      byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
    }
    const storage = createAdminClient().storage;
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += 500) {
        const { error: removeError } = await storage.from(bucket).remove(paths.slice(i, i + 500));
        if (removeError) console.warn(`[bogey/db] removing a deleted event's files:`, removeError);
      }
    }
    return ok(null);
  });

export type WindowChange = {
  key: string;
  opens_at: string | null;
  closes_at: string | null;
  override: Enums<"window_override"> | null;
};

export const setWindowsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; windows?: unknown; label?: unknown };
    if (!Array.isArray(raw.windows)) throw new Error("windows must be a list");
    const time = (value: unknown) =>
      typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
    const windows: WindowChange[] = raw.windows.map((entry) => {
      const w = (entry ?? {}) as Record<string, unknown>;
      if (typeof w.key !== "string" || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/.test(w.key)) {
        throw new Error("Unknown window");
      }
      return {
        key: w.key,
        opens_at: time(w.opens_at),
        closes_at: time(w.closes_at),
        override: w.override === "open" || w.override === "closed" ? w.override : null,
      };
    });
    return {
      eventId: requireId(raw.eventId, "eventId"),
      windows,
      label: typeof raw.label === "string" ? raw.label.slice(0, 80) : null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_windows", {
      p_event: data.eventId,
      p_windows: data.windows,
      ...(data.label ? { p_label: data.label } : {}),
    });
    if (error) return toFailure(error, "saving the schedule");
    return ok(null);
  });

export const removeWindowFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; key?: unknown };
    if (typeof raw.key !== "string" || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/.test(raw.key)) {
      throw new Error("Unknown window");
    }
    return { eventId: requireId(raw.eventId, "eventId"), key: raw.key };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("remove_window", {
      p_event: data.eventId,
      p_key: data.key,
    });
    if (error) {
      if (error.code === "23503") return fail("conflict", `Can't remove it: ${error.message}.`);
      return toFailure(error, "removing the window");
    }
    return ok(null);
  });

const EXTENSION_ROLE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export interface Person {
  userId: string;
  name: string;
  role: EventRole;
  email: string | null;
  team: string | null;
  divisionId: string | null;
  extraRoles: string[];
}

export interface EventPeople {
  registrations: Tables<"registrations">[];
  members: Person[];
}

export const eventPeopleFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<EventPeople>> => {
    const supabase = createServerClient();
    const [registrations, members, teams] = await Promise.all([
      supabase
        .from("registrations")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false }),
      supabase
        .from("event_members")
        .select(
          "user_id, role, division_id, profiles!event_members_user_id_fkey(display_name), event_role_grants(role_key)",
        )
        .eq("event_id", eventId)
        .eq("status", "active"),
      supabase.from("team_members").select("user_id, teams(name)").eq("event_id", eventId),
    ]);
    const error = registrations.error ?? members.error ?? teams.error;
    if (error) return toFailure(error, "loading people");

    const emails = new Map(
      (registrations.data ?? []).flatMap((row) =>
        row.user_id ? [[row.user_id, String(row.email)]] : [],
      ),
    );
    const teamOf = new Map(
      (teams.data ?? []).flatMap((row) => (row.teams ? [[row.user_id, row.teams.name]] : [])),
    );
    return ok({
      registrations: registrations.data ?? [],
      members: (members.data ?? [])
        .map((row) => ({
          userId: row.user_id,
          name: row.profiles?.display_name ?? "Member",
          role: row.role,
          email: emails.get(row.user_id) ?? null,
          team: teamOf.get(row.user_id) ?? null,
          divisionId: row.division_id,
          extraRoles: row.event_role_grants.map((grant) => grant.role_key),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

export const eventPeopleQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-people", eventId] as const,
    queryFn: async () => unwrap(await eventPeopleFn({ data: eventId })),
    retry: retryPolicy,
  });

export const reviewRegistrationFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { registrationId?: unknown; decision?: unknown };
    return {
      registrationId: requireId(raw.registrationId, "registrationId"),
      decision: requireOneOf(raw.decision, ["approved", "rejected"] as const, "decision"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: updated, error } = await supabase
      .from("registrations")
      .update({ status: data.decision })
      .eq("id", data.registrationId)
      .select("id");
    if (error) return toFailure(error, "reviewing that registration");
    if (!updated?.length) return fail("forbidden", "Only organizers can review registrations.");
    return ok(null);
  });

export const reviewRegistrationsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      eventId?: unknown;
      ids?: unknown;
      decision?: unknown;
      note?: unknown;
    };
    if (!Array.isArray(raw.ids) || raw.ids.length === 0 || raw.ids.length > 500) {
      throw new Error("Choose between 1 and 500 registrations");
    }
    return {
      eventId: requireId(raw.eventId, "eventId"),
      ids: raw.ids.map((id) => requireId(id, "registration")),
      decision: requireOneOf(raw.decision, ["approved", "rejected"] as const, "decision"),
      note: optionalText(raw.note, "Message", 1000),
    };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const { data: count, error } = await createServerClient().rpc("review_registrations", {
      p_event: data.eventId,
      p_ids: data.ids,
      p_status: data.decision,
      ...(data.note ? { p_note: data.note } : {}),
    });
    if (error) return toFailure(error, "reviewing those registrations");
    return ok(count);
  });

export const setMemberRoleFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; userId?: unknown; role?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId: requireId(raw.userId, "userId"),
      role: requireOneOf(raw.role, EVENT_ROLES, "Role"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: updated, error } = await supabase
      .from("event_members")
      .update({ role: data.role })
      .eq("event_id", data.eventId)
      .eq("user_id", data.userId)
      .select("user_id");
    if (error) return toFailure(error, "changing that role");
    if (!updated?.length) return fail("forbidden", "Only organizers can change roles.");
    return ok(null);
  });

export const setExtraRolesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; userId?: unknown; roles?: unknown };
    if (!Array.isArray(raw.roles) || raw.roles.length > 50) throw new Error("Roles must be a list");
    const roles = raw.roles.map((role) => {
      if (typeof role !== "string" || !EXTENSION_ROLE.test(role)) throw new Error("Unknown role");
      return role;
    });
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId: requireId(raw.userId, "userId"),
      roles: [...new Set(roles)],
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("set_role_grants", {
      p_event: data.eventId,
      p_user: data.userId,
      p_roles: data.roles,
    });
    if (error) return toFailure(error, "changing those roles");
    return ok(null);
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; userId?: unknown };
    return { eventId: requireId(raw.eventId, "eventId"), userId: requireId(raw.userId, "userId") };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: updated, error } = await supabase
      .from("event_members")
      .update({ status: "removed" })
      .eq("event_id", data.eventId)
      .eq("user_id", data.userId)
      .select("user_id");
    if (error) return toFailure(error, "removing that person");
    if (!updated?.length) return fail("forbidden", "Only organizers can remove people.");
    return ok(null);
  });
