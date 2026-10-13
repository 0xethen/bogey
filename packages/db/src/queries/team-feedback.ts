import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId } from "./validate.ts";

export interface TeamFeedback {
  notes: { id: string; body: string }[];
  scores: {
    roundName: string;
    roundOrdinal: number;
    label: string;
    minScore: number;
    maxScore: number;
    average: number;
    judges: number;
  }[];
}

export const teamFeedbackFn = createServerFn({ method: "GET" })
  .validator((submissionId: unknown) => requireId(submissionId, "submissionId"))
  .handler(async ({ data: submissionId }): Promise<DbResult<TeamFeedback>> => {
    const supabase = createServerClient();
    const [notes, scores] = await Promise.all([
      supabase
        .from("feedback")
        .select("id, body_md")
        .eq("submission_id", submissionId)
        .eq("visibility", "team")
        .order("created_at"),
      supabase.rpc("team_scores", { p_submission: submissionId }),
    ]);
    const error = notes.error ?? scores.error;
    if (error) return toFailure(error, "loading feedback");
    return ok({
      notes: (notes.data ?? []).map((row) => ({ id: row.id, body: row.body_md })),
      scores: (scores.data ?? []).map((row) => ({
        roundName: row.round_name,
        roundOrdinal: Number(row.round_ordinal),
        label: row.label,
        minScore: Number(row.min_score),
        maxScore: Number(row.max_score),
        average: Number(row.average),
        judges: Number(row.judges),
      })),
    });
  });

export const teamFeedbackQueryOptions = (submissionId: string) =>
  queryOptions({
    queryKey: ["team-feedback", submissionId] as const,
    queryFn: async () => unwrap(await teamFeedbackFn({ data: submissionId })),
    retry: retryPolicy,
  });
