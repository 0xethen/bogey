import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RosterRole } from "@bogey/utils/roster";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json, Tables } from "../types.ts";
import { optionalId, requireId, requireText } from "./validate.ts";
import { profileNames } from "./profile-names.ts";

const ROLES: Tuple<RosterRole> = ["participant", "judge", "staff", "organizer"];

export interface TeamMember {
  userId: string;
  name: string;
  captain: boolean;
}

export interface RosterTeam {
  id: string;
  name: string;
  locked: boolean;
  divisionId: string | null;
  members: TeamMember[];
}

export interface EventTeams {
  teams: RosterTeam[];
  unassigned: { userId: string; name: string }[];
}

export const eventTeamsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<EventTeams>> => {
    const supabase = createServerClient();
    const [teams, members, participants] = await Promise.all([
      supabase
        .from("teams")
        .select("id, name, locked_at, division_id")
        .eq("event_id", eventId)
        .order("name"),
      supabase
        .from("team_members")
        .select("team_id, user_id, role, joined_at")
        .eq("event_id", eventId),
      supabase
        .from("event_members")
        .select("user_id")
        .eq("event_id", eventId)
        .eq("role", "participant")
        .eq("status", "active"),
    ]);
    const error = teams.error ?? members.error ?? participants.error;
    if (error) return toFailure(error, "loading teams");

    const ids = (participants.data ?? []).map((row) => row.user_id);
    const { names, error: profileError } = await profileNames(supabase, ids);
    if (profileError) return toFailure(profileError, "loading teams");
    const onTeam = new Set((members.data ?? []).map((row) => row.user_id));

    return ok({
      teams: (teams.data ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        locked: !!team.locked_at,
        divisionId: team.division_id,
        members: (members.data ?? [])
          .filter((row) => row.team_id === team.id)
          .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
          .map((row) => ({
            userId: row.user_id,
            name: names.get(row.user_id) ?? "Participant",
            captain: row.role === "captain",
          })),
      })),
      unassigned: ids
        .filter((id) => !onTeam.has(id))
        .map((id) => ({ userId: id, name: names.get(id) ?? "Participant" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

export const eventTeamsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-teams", eventId] as const,
    queryFn: async () => unwrap(await eventTeamsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const setTeamMembershipFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; userId?: unknown; teamId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId: requireId(raw.userId, "userId"),
      teamId: raw.teamId ? requireId(raw.teamId, "teamId") : null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_team_membership", {
      p_event: data.eventId,
      p_user: data.userId,
      ...(data.teamId ? { p_team: data.teamId } : {}),
    });
    if (error) return toFailure(error, "moving them");
    return ok(null);
  });

export const organizerCreateTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; name?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      name: requireText(raw.name, "Team name", 60),
    };
  })
  .handler(async ({ data }): Promise<DbResult<Tables<"teams">>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: row, error } = await supabase
      .from("teams")
      .insert({ event_id: data.eventId, name: data.name, created_by: userData.user?.id ?? null })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return fail("conflict", "Another team already has that name.");
      return toFailure(error, "creating the team");
    }
    return ok(row);
  });

export const updateTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; name?: unknown; locked?: unknown };
    return {
      id: requireId(raw.id, "id"),
      name: raw.name === undefined ? undefined : requireText(raw.name, "Team name", 60),
      locked: typeof raw.locked === "boolean" ? raw.locked : undefined,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from("teams")
      .update({
        ...(data.name ? { name: data.name } : {}),
        ...(data.locked === undefined
          ? {}
          : { locked_at: data.locked ? new Date().toISOString() : null }),
      })
      .eq("id", data.id)
      .select("id");
    if (error) {
      if (error.code === "23505") return fail("conflict", "Another team already has that name.");
      return toFailure(error, "updating the team");
    }
    if (!rows.length) return fail("forbidden", "Only organizers can change this team.");
    return ok(null);
  });

export const setTeamsDivisionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; teamIds?: unknown; divisionId?: unknown };
    if (!Array.isArray(raw.teamIds) || raw.teamIds.length > 1000) {
      throw new Error("Pick up to 1000 teams.");
    }
    return {
      eventId: requireId(raw.eventId, "eventId"),
      teamIds: raw.teamIds.map((id) => requireId(id, "teamId")),
      divisionId: optionalId(raw.divisionId, "divisionId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: moved, error } = await supabase.rpc("set_teams_division", {
      p_event: data.eventId,
      p_teams: data.teamIds,
      p_division: data.divisionId,
    });
    if (error) return toFailure(error, "placing the teams");
    return ok(moved);
  });

export const disbandTeamFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase.from("teams").delete().eq("id", id).select("id");
    if (error) return toFailure(error, "disbanding the team");
    if (!rows.length) return fail("forbidden", "Only organizers can disband teams.");
    return ok(null);
  });

export interface ImportResult {
  added: number;
  updated: number;
  linked: number;
  asked: number;
}

const ROSTER_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const rosterRowsSchema = z
  .array(
    z.object({
      email: z.string().trim().toLowerCase().regex(ROSTER_EMAIL, "That isn't an email address"),
      name: z.string().trim().max(80).optional(),
      team: z.string().trim().max(60).optional(),
      teamOptions: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
      division: z.uuid().optional(),
      sessions: z.array(z.uuid()).max(50).optional(),
      answers: z.record(z.string().max(80), z.string().max(2000)).optional(),
      role: z.enum(["participant", "judge", "staff", "organizer"]).optional(),
    }),
  )
  .min(1, "Paste at least one email address")
  .max(5000, "Import at most 5,000 people at a time");

export const importRosterFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      eventId?: unknown;
      rows?: unknown;
      defaultRole?: unknown;
      notify?: unknown;
    };
    const defaultRole = ROLES.find((role) => role === raw.defaultRole) ?? "participant";
    const parsed = rosterRowsSchema.safeParse(raw.rows);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the roster");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      rows: parsed.data.map((row) => ({ ...row, role: row.role ?? defaultRole })),
      notify: raw.notify === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<ImportResult>> => {
    const supabase = createServerClient();
    const rows: Json = data.rows.map((row) => ({ ...row }));
    const { data: result, error } = await supabase.rpc("import_roster", {
      p_event: data.eventId,
      p_rows: rows,
      ...(data.notify ? { p_notify: true } : {}),
    });
    if (error) return toFailure(error, "importing");
    const counts = result && typeof result === "object" && !Array.isArray(result) ? result : {};
    const count = (key: string) => (typeof counts[key] === "number" ? counts[key] : 0);
    return ok({
      added: count("added"),
      updated: count("updated"),
      linked: count("linked"),
      asked: count("asked"),
    });
  });

export interface RosterOverlap {
  email: string;
  eventId: string;
  eventName: string;
  status: Tables<"registrations">["status"];
  otherName: string | null;
  name: string | null;
  nameDiffers: boolean;
}

export const rosterOverlapsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<RosterOverlap[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("roster_overlaps", { p_event: eventId });
    if (error) return toFailure(error, "checking other events");
    return ok(
      (data ?? []).map((row) => ({
        email: String(row.email),
        eventId: row.other_event_id,
        eventName: row.other_event_name,
        status: row.other_status,
        otherName: row.other_full_name,
        name: row.full_name,
        nameDiffers: row.name_differs,
      })),
    );
  });

export const rosterOverlapsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["roster-overlaps", eventId] as const,
    queryFn: async () => unwrap(await rosterOverlapsFn({ data: eventId })),
    retry: retryPolicy,
  });
