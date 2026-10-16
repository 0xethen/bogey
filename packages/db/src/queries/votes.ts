import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId } from "./validate.ts";

export const myVotesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string[]>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return ok([]);
    const { data, error } = await supabase
      .from("votes")
      .select("submission_id")
      .eq("event_id", eventId)
      .eq("voter_id", userData.user.id);
    if (error) return toFailure(error, "loading your votes");
    return ok(data.map((row) => row.submission_id));
  });

export const myVotesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-votes", eventId] as const,
    queryFn: async () => unwrap(await myVotesFn({ data: eventId })),
    retry: retryPolicy,
  });

export const voteCountsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(
    async ({ data: eventId }): Promise<DbResult<{ submissionId: string; count: number }[]>> => {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc("vote_counts", { p_event: eventId });
      if (error) return toFailure(error, "counting votes");
      return ok(data.map((row) => ({ submissionId: row.submission_id, count: Number(row.votes) })));
    },
  );

export const voteCountsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["vote-counts", eventId] as const,
    queryFn: async () => unwrap(await voteCountsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const setVoteFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; vote?: unknown };
    return { submissionId: requireId(raw.submissionId, "submissionId"), vote: raw.vote !== false };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user)
      return fail("forbidden", "Your credentials are invalid or expired. Please log in again.");
    const { error } = data.vote
      ? await supabase.rpc("cast_vote", { p_submission: data.submissionId })
      : await supabase.rpc("retract_vote", { p_submission: data.submissionId });
    if (error) return toFailure(error, data.vote ? "voting" : "taking back your vote");
    return ok(null);
  });
