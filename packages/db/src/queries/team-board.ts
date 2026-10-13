import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseLabels, type Group } from "@bogey/utils/team-matcher";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Database } from "../types.ts";
import { optionalText, requireId, requireOneOf } from "./validate.ts";

type Functions = Database["public"]["Functions"];

export type SeekerCard = Functions["team_board_people"]["Returns"][number];
export type TeamOpening = Functions["team_board_openings"]["Returns"][number];
export type TeamRequest = Omit<
  Functions["team_requests_inbox"]["Returns"][number],
  "direction" | "status"
> & {
  direction: "request" | "invite";
  status: "pending" | "accepted" | "declined" | "withdrawn";
};

const DIRECTIONS = ["request", "invite"] as const;
const STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;

function labels(value: unknown, field: string): string[] {
  if (Array.isArray(value))
    return parseLabels(value.filter((x) => typeof x === "string").join(","));
  return parseLabels(optionalText(value, field, 1000) ?? "");
}

export const teamBoardPeopleFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<SeekerCard[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("team_board_people", { p_event: eventId });
    if (error) return toFailure(error, "loading people looking for a team");
    return ok(data);
  });

export const teamBoardPeopleQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["team-board", eventId, "people"] as const,
    queryFn: async () => unwrap(await teamBoardPeopleFn({ data: eventId })),
    retry: retryPolicy,
  });

export const teamBoardOpeningsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<TeamOpening[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("team_board_openings", { p_event: eventId });
    if (error) return toFailure(error, "loading teams looking for people");
    return ok(data);
  });

export const teamBoardOpeningsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["team-board", eventId, "openings"] as const,
    queryFn: async () => unwrap(await teamBoardOpeningsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const teamRequestsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<TeamRequest[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("team_requests_inbox", { p_event: eventId });
    if (error) return toFailure(error, "loading requests and invitations");
    return ok(
      data.map((row) => ({
        ...row,
        direction: requireOneOf(row.direction, DIRECTIONS, "direction"),
        status: requireOneOf(row.status, STATUSES, "status"),
      })),
    );
  });

export const teamRequestsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["team-board", eventId, "requests"] as const,
    queryFn: async () => unwrap(await teamRequestsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const saveTeamSeekerFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      skills: labels(raw.skills, "Skills"),
      interests: labels(raw.interests, "Interests"),
      timezone: optionalText(raw.timezone, "Time zone", 60) ?? "",
      blurb: optionalText(raw.blurb, "About you", 500) ?? "",
      looking: raw.looking !== false,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("save_team_seeker", {
      p_event: data.eventId,
      p_skills: data.skills,
      p_interests: data.interests,
      p_timezone: data.timezone,
      p_blurb: data.blurb,
      p_looking: data.looking,
    });
    if (error) return toFailure(error, "saving your card");
    return ok(null);
  });

export const saveTeamOpeningFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      blurb: optionalText(raw.blurb, "What you're building", 500) ?? "",
      wanted: labels(raw.wanted, "Skills wanted"),
      open: raw.open !== false,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("save_team_opening", {
      p_event: data.eventId,
      p_blurb: data.blurb,
      p_wanted: data.wanted,
      p_open: data.open,
    });
    if (error) return toFailure(error, "saving your team's post");
    return ok(null);
  });

export const requestToJoinTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      teamId: requireId(raw.teamId, "teamId"),
      message: optionalText(raw.message, "Message", 500) ?? "",
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: id, error } = await supabase.rpc("request_to_join_team", {
      p_event: data.eventId,
      p_team: data.teamId,
      p_message: data.message,
    });
    if (error) return toFailure(error, "asking to join");
    return ok(id);
  });

export const inviteToTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      userId: requireId(raw.userId, "userId"),
      message: optionalText(raw.message, "Message", 500) ?? "",
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: id, error } = await supabase.rpc("invite_to_team", {
      p_event: data.eventId,
      p_user: data.userId,
      p_message: data.message,
    });
    if (error) return toFailure(error, "sending the invitation");
    return ok(id);
  });

export const answerTeamRequestFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return { requestId: requireId(raw.requestId, "requestId"), accept: raw.accept === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("answer_team_request", {
      p_request: data.requestId,
      p_accept: data.accept,
    });
    if (error) return toFailure(error, "answering");
    return ok(null);
  });

export const withdrawTeamRequestFn = createServerFn({ method: "POST" })
  .validator((requestId: unknown) => requireId(requestId, "requestId"))
  .handler(async ({ data: requestId }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("withdraw_team_request", { p_request: requestId });
    if (error) return toFailure(error, "withdrawing");
    return ok(null);
  });

const overviewSchema = z.object({
  min: z.number(),
  max: z.number(),
  people: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      skills: z.array(z.string()),
      interests: z.array(z.string()),
      timezone: z.string().nullable(),
      division: z.string().nullable(),
    }),
  ),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      locked: z.boolean(),
      division: z.string().nullable(),
      members: z.number(),
      skills: z.array(z.string()),
    }),
  ),
});

export type MatchingOverview = z.infer<typeof overviewSchema>;

export const teamMatchingOverviewFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<MatchingOverview>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("team_matching_overview", { p_event: eventId });
    if (error) return toFailure(error, "loading people without a team");
    return ok(overviewSchema.parse(data));
  });

export const teamMatchingOverviewQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["team-board", eventId, "overview"] as const,
    queryFn: async () => unwrap(await teamMatchingOverviewFn({ data: eventId })),
    retry: retryPolicy,
  });

const groupsSchema = z
  .array(
    z.object({
      team: z.string().uuid().nullable(),
      name: z.string().trim().min(1).max(60).nullable(),
      members: z.array(z.string().uuid()).max(100),
    }),
  )
  .max(500);

export const applyTeamMatchingFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const groups: Group[] = groupsSchema.parse(raw.groups);
    return { eventId: requireId(raw.eventId, "eventId"), groups };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: moved, error } = await supabase.rpc("apply_team_matching", {
      p_event: data.eventId,
      p_groups: data.groups.map((group) => ({ ...group })),
    });
    if (error) return toFailure(error, "applying the teams");
    return ok(moved);
  });
