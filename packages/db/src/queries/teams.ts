import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Tables } from "../types.ts";
import { requireId, requireText } from "./validate.ts";
import { profileNames } from "./profile-names.ts";

export type Team = Tables<"teams">;

export interface Teammate {
  userId: string;
  name: string;
  role: Enums<"team_role">;
  joinedAt: string;
}

export interface MyTeam {
  team: Team;
  members: Teammate[];
  /** How many times the caller has left (or disbanded) a team in this event, for its leave limit. */
  timesLeft: number;
}

export const myTeamFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<MyTeam | null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");

    const { data: mine, error } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("event_id", eventId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error) return toFailure(error, "loading your team");
    if (!mine) return ok(null);

    const [team, members, me] = await Promise.all([
      supabase.from("teams").select("*").eq("id", mine.team_id).maybeSingle(),
      supabase
        .from("team_members")
        .select("user_id, role, joined_at")
        .eq("team_id", mine.team_id)
        .order("joined_at"),
      supabase
        .from("event_members")
        .select("teams_left")
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .maybeSingle(),
    ]);
    const failure = team.error ?? members.error ?? me.error;
    if (failure) return toFailure(failure, "loading your team");
    if (!team.data) return ok(null);

    const ids = (members.data ?? []).map((row) => row.user_id);
    const { names, error: profileError } = await profileNames(supabase, ids);
    if (profileError) return toFailure(profileError, "loading your teammates");

    return ok({
      team: team.data,
      members: (members.data ?? []).map((row) => ({
        userId: row.user_id,
        name: names.get(row.user_id) ?? "Teammate",
        role: row.role,
        joinedAt: row.joined_at,
      })),
      timesLeft: me.data?.teams_left ?? 0,
    });
  });

export const myTeamQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-team", eventId] as const,
    queryFn: async () => unwrap(await myTeamFn({ data: eventId })),
    retry: retryPolicy,
  });

export const createTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; name?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      name: requireText(raw.name, "Team name", 60),
    };
  })
  .handler(async ({ data }): Promise<DbResult<Team>> => {
    const supabase = createServerClient();
    const { data: team, error } = await supabase.rpc("create_team", {
      p_event: data.eventId,
      p_name: data.name,
    });
    if (error) {
      if (error.code === "23505") return fail("conflict", "Another team already has that name.");
      return toFailure(error, "creating the team");
    }
    return ok(team);
  });

const teamPreviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  locked: z.boolean(),
  size_max: z.number().nullable(),
  members: z.array(z.string()),
});

export interface TeamPreview {
  id: string;
  name: string;
  locked: boolean;
  sizeMax: number | null;
  members: string[];
}

export const teamPreviewFn = createServerFn({ method: "GET" })
  .validator((code: unknown) => requireText(code, "Invite code", 32))
  .handler(async ({ data: code }): Promise<DbResult<TeamPreview>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("team_preview", { p_invite_code: code });
    if (error) return toFailure(error, "finding the team");
    const team = teamPreviewSchema.parse(data);
    return ok({
      id: team.id,
      name: team.name,
      locked: team.locked,
      sizeMax: team.size_max,
      members: team.members,
    });
  });

export const joinTeamFn = createServerFn({ method: "POST" })
  .validator((code: unknown) => requireText(code, "Invite code", 32))
  .handler(async ({ data: code }): Promise<DbResult<Team>> => {
    const supabase = createServerClient();
    const { data: team, error } = await supabase.rpc("join_team", { p_invite_code: code });
    if (error) return toFailure(error, "joining the team");
    return ok(team);
  });

export const leaveTeamFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("leave_team", { p_event: eventId });
    if (error) return toFailure(error, "leaving the team");
    return ok(null);
  });

export const renameTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { teamId?: unknown; name?: unknown };
    return {
      teamId: requireId(raw.teamId, "teamId"),
      name: requireText(raw.name, "Team name", 60),
    };
  })
  .handler(async ({ data }): Promise<DbResult<Team>> => {
    const supabase = createServerClient();
    const { data: team, error } = await supabase
      .from("teams")
      .update({ name: data.name })
      .eq("id", data.teamId)
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return fail("conflict", "Another team already has that name.");
      return toFailure(error, "renaming the team");
    }
    if (!team)
      return fail("forbidden", "Only the captain can rename the team, while teams are open.");
    return ok(team);
  });

export const teamNameTakenFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; name?: unknown; exceptTeamId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      name: requireText(raw.name, "Team name", 60),
      exceptTeamId: raw.exceptTeamId ? requireId(raw.exceptTeamId, "exceptTeamId") : null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<boolean>> => {
    const supabase = createServerClient();
    let query = supabase
      .from("teams")
      .select("id")
      .eq("event_id", data.eventId)
      .eq("name", data.name)
      .limit(1);
    if (data.exceptTeamId) query = query.neq("id", data.exceptTeamId);
    const { data: rows, error } = await query;
    if (error) return toFailure(error, "checking the team name");
    return ok(rows.length > 0);
  });

export const newTeamCodeFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string>> => {
    const { data: code, error } = await createServerClient().rpc("new_team_code", {
      p_event: eventId,
    });
    if (error) return toFailure(error, "changing the team's code");
    return ok(code);
  });

export const disbandMyTeamFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("disband_team", { p_event: eventId });
    if (error) return toFailure(error, "disbanding the team");
    return ok(null);
  });
