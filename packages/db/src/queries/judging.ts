import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Json, Tables } from "../types.ts";
import { optionalId, requireId, requireNumber, requireText } from "./validate.ts";
import { activeRound, type RoundEntry, type RoundInfo } from "@bogey/utils/rounds";
import { parseAwards, type Award } from "./awards.ts";

export type Criterion = Tables<"criteria">;
export type Rubric = Tables<"rubrics">;
export type AssignmentStatus = Enums<"assignment_status">;
export type FeedbackVisibility = Enums<"feedback_visibility">;

export const criteriaQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["criteria", eventId] as const,
    queryFn: async () => unwrap(await criteriaFn({ data: eventId })),
    retry: retryPolicy,
  });

export const criteriaFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Criterion[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("criteria")
      .select("*")
      .eq("event_id", eventId)
      .order("sort");
    if (error) return toFailure(error, "loading criteria");
    return ok(data ?? []);
  });

export const rubricsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Rubric[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("rubrics")
      .select("*")
      .eq("event_id", eventId)
      .order("sort");
    if (error) return toFailure(error, "loading rubrics");
    return ok(data ?? []);
  });

export const rubricsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["rubrics", eventId] as const,
    queryFn: async () => unwrap(await rubricsFn({ data: eventId })),
    retry: retryPolicy,
  });

/** The criteria a project is scored on in a round: shared ones plus its rubric's. */
export function criteriaFor(
  criteria: Tuple<Criterion>,
  roundId: string,
  rubricId: string | null,
): Criterion[] {
  return criteria.filter(
    (criterion) =>
      (!criterion.round_id || criterion.round_id === roundId) &&
      (!criterion.rubric_id || criterion.rubric_id === rubricId),
  );
}

export const submissionRubricFn = createServerFn({ method: "GET" })
  .validator((submissionId: unknown) => requireId(submissionId, "submissionId"))
  .handler(async ({ data: submissionId }): Promise<DbResult<string | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("submission_rubrics")
      .select("rubric_id")
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (error) return toFailure(error, "loading the rubric");
    return ok(data?.rubric_id ?? null);
  });

export const submissionRubricQueryOptions = (submissionId: string) =>
  queryOptions({
    queryKey: ["submission-rubric", submissionId] as const,
    queryFn: async () => unwrap(await submissionRubricFn({ data: submissionId })),
    retry: retryPolicy,
  });

export const setSubmissionRubricFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; rubricId?: unknown };
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      rubricId: optionalId(raw.rubricId, "rubricId") ?? null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_submission_rubric", {
      p_submission: data.submissionId,
      ...(data.rubricId ? { p_rubric: data.rubricId } : {}),
    });
    if (error) return toFailure(error, "picking the rubric");
    return ok(null);
  });

export interface JudgingRound extends RoundInfo {
  windowKey: string | null;
  method: string;
}

export interface JudgingRounds {
  rounds: JudgingRound[];
  entries: RoundEntry[];
}

export const judgingRoundsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<JudgingRounds>> => {
    const supabase = createServerClient();
    const [rounds, entries] = await Promise.all([
      supabase
        .from("judging_rounds")
        .select("id, form_id, ordinal, name, window_key, method")
        .eq("event_id", eventId)
        .order("ordinal"),
      supabase.from("round_entries").select("round_id, submission_id").eq("event_id", eventId),
    ]);
    const error = rounds.error ?? entries.error;
    if (error) return toFailure(error, "loading rounds");
    return ok({
      rounds: (rounds.data ?? []).map((row) => ({
        id: row.id,
        formId: row.form_id,
        ordinal: row.ordinal,
        name: row.name,
        windowKey: row.window_key,
        method: row.method,
      })),
      entries: (entries.data ?? []).map((row) => ({
        roundId: row.round_id,
        submissionId: row.submission_id,
      })),
    });
  });

export const judgingRoundsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["judging-rounds", eventId] as const,
    queryFn: async () => unwrap(await judgingRoundsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const advanceSubmissionsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { roundId?: unknown; top?: unknown; submissions?: unknown };
    const roundId = requireId(raw.roundId, "roundId");
    if (Array.isArray(raw.submissions)) {
      return {
        roundId,
        submissions: raw.submissions.slice(0, 500).map((id) => requireId(id, "submission")),
      };
    }
    return { roundId, top: Math.round(requireNumber(raw.top, "How many", 1, 500)) };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: next, error } = await supabase.rpc("advance_submissions", {
      p_round: data.roundId,
      ...("submissions" in data ? { p_submissions: data.submissions } : { p_top: data.top }),
    });
    if (error) return toFailure(error, "advancing entries");
    return ok(next);
  });

export const saveRoundFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      roundId?: unknown;
      name?: unknown;
      windowKey?: unknown;
      method?: unknown;
    };
    const method = raw.method === undefined ? "rubric" : raw.method;
    if (typeof method !== "string" || !(method === "rubric" || PLUGIN_METHOD.test(method))) {
      throw new Error("Unknown ranking method");
    }
    return {
      roundId: requireId(raw.roundId, "roundId"),
      name: requireText(raw.name, "Round name", 60),
      windowKey: typeof raw.windowKey === "string" && raw.windowKey ? raw.windowKey : null,
      method,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("judging_rounds")
      .update({ name: data.name, window_key: data.windowKey, method: data.method })
      .eq("id", data.roundId);
    if (error?.code === "22023") return fail("invalid", error.message);
    if (error) return toFailure(error, "saving the round");
    return ok(null);
  });

const PLUGIN_METHOD = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

async function currentRound(
  supabase: ReturnType<typeof createServerClient>,
  submissionId: string,
): Promise<DbResult<JudgingRound>> {
  const submission = await supabase
    .from("submissions")
    .select("id, form_id, event_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (submission.error) return toFailure(submission.error, "finding the round");
  if (!submission.data) return fail("not_found", "That project isn't available.");
  const [rounds, entries] = await Promise.all([
    supabase
      .from("judging_rounds")
      .select("id, form_id, ordinal, name, window_key, method")
      .eq("form_id", submission.data.form_id),
    supabase
      .from("round_entries")
      .select("round_id, submission_id")
      .eq("submission_id", submissionId),
  ]);
  const error = rounds.error ?? entries.error;
  if (error) return toFailure(error, "finding the round");
  const found = activeRound(
    (rounds.data ?? []).map((row) => ({
      id: row.id,
      formId: row.form_id,
      ordinal: row.ordinal,
      name: row.name,
      windowKey: row.window_key,
      method: row.method,
    })),
    (entries.data ?? []).map((row) => ({ roundId: row.round_id, submissionId: row.submission_id })),
    { id: submission.data.id, formId: submission.data.form_id },
  );
  return found ? ok(found) : fail("not_found", "That project isn't in a judged form.");
}

export interface JudgeQueueItem {
  submissionId: string;
  title: string;
  teamName: string;
  formTitle: string;
  roundId: string;
  roundName: string;
  roundOrdinal: number;
  table: string | null;
  trackIds: string[];
  assigned: boolean;
  status: AssignmentStatus | null;
  scored: number;
  flagged: boolean;
}

export const judgeQueueFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<JudgeQueueItem[]>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return fail("forbidden", "Sign in first.");

    const [submissions, assignments, scores, roundData, conflicts, flags] = await Promise.all([
      supabase
        .from("submissions")
        .select(
          "id, title, form_id, team_id, table_label, teams(name), submission_forms!inner(title, judged), submission_tracks(track_id)",
        )
        .eq("event_id", eventId)
        .eq("status", "submitted")
        .eq("submission_forms.judged", true),
      supabase
        .from("judge_assignments")
        .select("submission_id, round_id, status")
        .eq("event_id", eventId)
        .eq("judge_id", userId),
      supabase
        .from("scores")
        .select("submission_id, round_id")
        .eq("event_id", eventId)
        .eq("judge_id", userId),
      judgingRoundsFn({ data: eventId }),
      supabase
        .from("judge_conflicts")
        .select("team_id")
        .eq("event_id", eventId)
        .eq("judge_id", userId),
      supabase
        .from("judging_flags")
        .select("submission_id")
        .eq("event_id", eventId)
        .is("resolved_at", null),
    ]);
    if (!roundData.ok) return roundData;
    const error =
      submissions.error ?? assignments.error ?? scores.error ?? conflicts.error ?? flags.error;
    if (error) return toFailure(error, "loading your judging queue");
    const barred = new Set((conflicts.data ?? []).map((row) => row.team_id));
    const flagged = new Set((flags.data ?? []).map((row) => row.submission_id));

    const rounds = roundData.data;
    const status = new Map(
      (assignments.data ?? []).map((row) => [`${row.submission_id}:${row.round_id}`, row.status]),
    );
    const scored = new Map<string, number>();
    for (const row of scores.data ?? []) {
      const key = `${row.submission_id}:${row.round_id}`;
      scored.set(key, (scored.get(key) ?? 0) + 1);
    }
    return ok(
      (submissions.data ?? [])
        .flatMap((row) => {
          if (barred.has(row.team_id)) return [];
          const round = activeRound(rounds.rounds, rounds.entries, {
            id: row.id,
            formId: row.form_id,
          });
          if (!round) return [];
          const key = `${row.id}:${round.id}`;
          return [
            {
              submissionId: row.id,
              title: row.title || "Untitled",
              teamName: row.teams?.name ?? "A team",
              formTitle: row.submission_forms.title,
              roundId: round.id,
              roundName: round.name,
              roundOrdinal: round.ordinal,
              table: row.table_label,
              trackIds: row.submission_tracks.map((link) => link.track_id),
              assigned: status.has(key),
              status: status.get(key) ?? null,
              scored: scored.get(key) ?? 0,
              flagged: flagged.has(row.id),
            },
          ];
        })
        .sort(
          (a, b) =>
            Number(b.assigned) - Number(a.assigned) ||
            Number(a.status === "skipped") - Number(b.status === "skipped") ||
            (a.table ?? "~").localeCompare(b.table ?? "~", undefined, { numeric: true }) ||
            a.title.localeCompare(b.title),
        ),
    );
  });

export const judgeQueueQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["judge-queue", eventId] as const,
    queryFn: async () => unwrap(await judgeQueueFn({ data: eventId })),
    retry: retryPolicy,
  });

export interface JudgeSheet {
  roundId: string;
  roundName: string;
  roundOrdinal: number;
  scores: { [criterionId: string]: number };
  feedback: { id: string; body: string; visibility: FeedbackVisibility } | null;
  status: AssignmentStatus | null;
  rubricId: string | null;
}

export const judgeSheetFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; submissionId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      submissionId: requireId(raw.submissionId, "submissionId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<JudgeSheet>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return fail("forbidden", "Sign in first.");
    const round = await currentRound(supabase, data.submissionId);
    if (!round.ok) return round;
    const [scores, feedback, assignment, rubric] = await Promise.all([
      supabase
        .from("scores")
        .select("criterion_id, value")
        .eq("submission_id", data.submissionId)
        .eq("round_id", round.data.id)
        .eq("judge_id", userId),
      supabase
        .from("feedback")
        .select("id, body_md, visibility")
        .eq("submission_id", data.submissionId)
        .eq("round_id", round.data.id)
        .eq("judge_id", userId)
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("judge_assignments")
        .select("status")
        .eq("submission_id", data.submissionId)
        .eq("round_id", round.data.id)
        .eq("judge_id", userId)
        .maybeSingle(),
      supabase
        .from("submission_rubrics")
        .select("rubric_id")
        .eq("submission_id", data.submissionId)
        .maybeSingle(),
    ]);
    const error = scores.error ?? feedback.error ?? assignment.error ?? rubric.error;
    if (error) return toFailure(error, "loading your scores");
    return ok({
      roundId: round.data.id,
      roundName: round.data.name,
      roundOrdinal: round.data.ordinal,
      scores: Object.fromEntries(
        (scores.data ?? []).map((row) => [row.criterion_id, Number(row.value)]),
      ),
      feedback: feedback.data
        ? {
            id: feedback.data.id,
            body: feedback.data.body_md,
            visibility: feedback.data.visibility,
          }
        : null,
      status: assignment.data?.status ?? null,
      rubricId: rubric.data?.rubric_id ?? null,
    });
  });

export const judgeSheetQueryOptions = (eventId: string, submissionId: string) =>
  queryOptions({
    queryKey: ["judge-sheet", eventId, submissionId] as const,
    queryFn: async () => unwrap(await judgeSheetFn({ data: { eventId, submissionId } })),
    retry: retryPolicy,
  });

export interface SheetChanges {
  eventId: string;
  submissionId: string;
  scores: { criterionId: string; value: number }[];
  feedback: string;
  visibility: FeedbackVisibility;
  done: boolean;
}

export const saveSheetFn = createServerFn({ method: "POST" })
  .validator((input: unknown): SheetChanges => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const scores = Array.isArray(raw.scores)
      ? raw.scores.map((entry) => {
          const score = (entry ?? {}) as { criterionId?: unknown; value?: unknown };
          const value = Number(score.value);
          if (!Number.isFinite(value)) throw new Error("Scores must be numbers");
          return { criterionId: requireId(score.criterionId, "criterionId"), value };
        })
      : [];
    return {
      eventId: requireId(raw.eventId, "eventId"),
      submissionId: requireId(raw.submissionId, "submissionId"),
      scores,
      feedback: typeof raw.feedback === "string" ? raw.feedback.trim().slice(0, 10_000) : "",
      visibility: raw.visibility === "team" ? "team" : "judges",
      done: raw.done === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return fail("forbidden", "Sign in first.");

    const round = await currentRound(supabase, data.submissionId);
    if (!round.ok) return round;
    const roundId = round.data.id;

    if (data.scores.length) {
      const { error } = await supabase.from("scores").upsert(
        data.scores.map((score) => ({
          event_id: data.eventId,
          submission_id: data.submissionId,
          round_id: roundId,
          judge_id: userId,
          criterion_id: score.criterionId,
          value: score.value,
        })),
        { onConflict: "judge_id,submission_id,criterion_id,round_id" },
      );
      if (error) {
        if (error.code === "42501") return fail("forbidden", "Judging isn't open right now.");
        return toFailure(error, "saving scores");
      }
    }

    const { data: existing } = await supabase
      .from("feedback")
      .select("id")
      .eq("submission_id", data.submissionId)
      .eq("round_id", roundId)
      .eq("judge_id", userId)
      .limit(1)
      .maybeSingle();
    if (existing && !data.feedback) {
      const { error } = await supabase.from("feedback").delete().eq("id", existing.id);
      if (error) return toFailure(error, "saving your note");
    } else if (existing) {
      const { error } = await supabase
        .from("feedback")
        .update({ body_md: data.feedback, visibility: data.visibility })
        .eq("id", existing.id);
      if (error) return toFailure(error, "saving your note");
    } else if (data.feedback) {
      const { error } = await supabase.from("feedback").insert({
        event_id: data.eventId,
        submission_id: data.submissionId,
        round_id: roundId,
        judge_id: userId,
        body_md: data.feedback,
        visibility: data.visibility,
      });
      if (error) return toFailure(error, "saving your note");
    }

    await supabase
      .from("judge_assignments")
      .update({ status: data.done ? "done" : "started" })
      .eq("submission_id", data.submissionId)
      .eq("round_id", roundId)
      .eq("judge_id", userId);
    return ok(null);
  });

export interface CriterionDraft {
  id: string | null;
  label: string;
  descriptionMd: string;
  minScore: number;
  maxScore: number;
  weight: number;
  roundId: string | null;
  rubricId: string | null;
}

export interface RubricDraft {
  id: string;
  name: string;
  descriptionMd: string;
}

export const saveCriteriaFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; items?: unknown; rubrics?: unknown };
    if (!Array.isArray(raw.items) || raw.items.length > 60) {
      throw new Error("Use at most 60 criteria");
    }
    if (raw.rubrics !== undefined && (!Array.isArray(raw.rubrics) || raw.rubrics.length > 20)) {
      throw new Error("Use at most 20 rubrics");
    }
    const rubrics = Array.isArray(raw.rubrics)
      ? raw.rubrics.map((entry): RubricDraft => {
          const item = (entry ?? {}) as Record<string, unknown>;
          return {
            id: requireId(item.id, "rubric id"),
            name: requireText(item.name, "Rubric", 60),
            descriptionMd:
              typeof item.descriptionMd === "string" ? item.descriptionMd.slice(0, 2000) : "",
          };
        })
      : null;
    if (
      rubrics &&
      new Set(rubrics.map((item) => item.name.toLowerCase())).size !== rubrics.length
    ) {
      throw new Error("Two rubrics share a name");
    }
    const items = raw.items.map((entry): CriterionDraft => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const minScore = Number(item.minScore ?? 0);
      const maxScore = Number(item.maxScore);
      const weight = Number(item.weight);
      if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 100) {
        throw new Error("Top scores are whole numbers from 1 to 100");
      }
      if (!Number.isInteger(minScore) || minScore < 0 || minScore >= maxScore) {
        throw new Error("Lowest scores are whole numbers below the top score");
      }
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
        throw new Error("Weights are numbers above 0");
      }
      return {
        id: typeof item.id === "string" && item.id ? requireId(item.id, "criterion id") : null,
        label: requireText(item.label, "Criterion", 80),
        descriptionMd:
          typeof item.descriptionMd === "string" ? item.descriptionMd.slice(0, 2000) : "",
        minScore,
        maxScore,
        weight,
        roundId: optionalId(item.roundId, "roundId") ?? null,
        rubricId: optionalId(item.rubricId, "rubricId") ?? null,
      };
    });
    const labels = new Set(items.map((item) => item.label.toLowerCase()));
    if (labels.size !== items.length) throw new Error("Two criteria share a name");
    return { eventId: requireId(raw.eventId, "eventId"), items, rubrics };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const items: Json = data.items.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      label: item.label,
      description_md: item.descriptionMd,
      min_score: item.minScore,
      max_score: item.maxScore,
      weight: item.weight,
      round_id: item.roundId,
      rubric_id: item.rubricId,
    }));
    const { data: removed, error } = await supabase.rpc("save_criteria", {
      p_event: data.eventId,
      p_items: items,
      ...(data.rubrics
        ? {
            p_rubrics: data.rubrics.map((rubric) => ({
              id: rubric.id,
              name: rubric.name,
              description_md: rubric.descriptionMd,
            })),
          }
        : {}),
    });
    if (error) return toFailure(error, "saving criteria");
    return ok(removed ?? 0);
  });

export interface JudgeProgress {
  userId: string;
  name: string;
  assigned: number;
  done: number;
  scored: number;
}

export interface JudgingProgress {
  judges: JudgeProgress[];
  unscored: number;
  submissions: number;
}

export const judgingProgressFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<JudgingProgress>> => {
    const supabase = createServerClient();
    const [judges, assignments, scores, submissions, rounds, entries] = await Promise.all([
      supabase
        .from("event_members")
        .select("user_id")
        .eq("event_id", eventId)
        .eq("role", "judge")
        .eq("status", "active"),
      supabase
        .from("judge_assignments")
        .select("judge_id, submission_id, round_id, status")
        .eq("event_id", eventId),
      supabase.from("scores").select("judge_id, submission_id, round_id").eq("event_id", eventId),
      supabase
        .from("submissions")
        .select("id, form_id, submission_forms!inner(judged)")
        .eq("event_id", eventId)
        .eq("status", "submitted")
        .eq("submission_forms.judged", true),
      supabase.from("judging_rounds").select("id, form_id, ordinal, name").eq("event_id", eventId),
      supabase.from("round_entries").select("round_id, submission_id").eq("event_id", eventId),
    ]);
    const error =
      judges.error ??
      assignments.error ??
      scores.error ??
      submissions.error ??
      rounds.error ??
      entries.error;
    if (error) return toFailure(error, "loading judging progress");

    const roundInfo: RoundInfo[] = (rounds.data ?? []).map((row) => ({
      id: row.id,
      formId: row.form_id,
      ordinal: row.ordinal,
      name: row.name,
    }));
    const roundEntries: RoundEntry[] = (entries.data ?? []).map((row) => ({
      roundId: row.round_id,
      submissionId: row.submission_id,
    }));
    const current = new Map(
      (submissions.data ?? []).map((row) => [
        row.id,
        activeRound(roundInfo, roundEntries, { id: row.id, formId: row.form_id })?.id,
      ]),
    );
    const inCurrent = (row: { submission_id: string; round_id: string }) =>
      current.get(row.submission_id) === row.round_id;
    const currentAssignments = (assignments.data ?? []).filter(inCurrent);
    const currentScores = (scores.data ?? []).filter(inCurrent);

    const ids = (judges.data ?? []).map((row) => row.user_id);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, display_name").in("id", ids)
      : { data: [] };
    const names = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));
    const scoredBy = new Map<string, Set<string>>();
    for (const row of currentScores) {
      const set = scoredBy.get(row.judge_id) ?? new Set<string>();
      set.add(row.submission_id);
      scoredBy.set(row.judge_id, set);
    }
    const anyScore = new Set(currentScores.map((row) => row.submission_id));

    return ok({
      judges: ids
        .map((id) => {
          const mine = currentAssignments.filter((row) => row.judge_id === id);
          return {
            userId: id,
            name: names.get(id) ?? "Judge",
            assigned: mine.length,
            done: mine.filter((row) => row.status === "done").length,
            scored: scoredBy.get(id)?.size ?? 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      unscored: (submissions.data ?? []).filter((row) => !anyScore.has(row.id)).length,
      submissions: submissions.data?.length ?? 0,
    });
  });

export const judgingProgressQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["judging-progress", eventId] as const,
    queryFn: async () => unwrap(await judgingProgressFn({ data: eventId })),
    retry: retryPolicy,
  });

export const assignJudgesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; perSubmission?: unknown; roundId?: unknown };
    const per = Number(raw.perSubmission);
    if (!Number.isInteger(per) || per < 1 || per > 20) {
      throw new Error("Judges per project is a whole number from 1 to 20");
    }
    const roundId = optionalId(raw.roundId, "roundId");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      perSubmission: per,
      ...(roundId ? { roundId } : {}),
    };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: count, error } = await supabase.rpc("assign_round_robin", {
      p_event: data.eventId,
      p_per_submission: data.perSubmission,
      ...(data.roundId ? { p_round: data.roundId } : {}),
    });
    if (error) return toFailure(error, "assigning judges");
    return ok(count ?? 0);
  });

export interface ResultRow {
  submissionId: string;
  title: string;
  teamId: string;
  teamName: string;
  formId: string;
  formTitle: string;
  score: number | null;
  rawScore: number | null;
  rank: number;
  divisionRank: number;
  divisionId: string | null;
  roundId: string;
  roundOrdinal: number;
  roundName: string;
  judges: number;
  conflicted: number;
  method: string;
  rubric: string | null;
  detail: Record<string, Json | undefined>;
}

export function groupResults(rows: Tuple<ResultRow>): { title: string; rows: ResultRow[] }[] {
  const roundsOfForm = new Map<string, Set<string>>();
  for (const row of rows) {
    roundsOfForm.set(row.formId, (roundsOfForm.get(row.formId) ?? new Set()).add(row.roundId));
  }
  const groups = new Map<string, { title: string; rows: ResultRow[]; order: number }>();
  for (const row of rows) {
    const several = (roundsOfForm.get(row.formId)?.size ?? 0) > 1;
    const key = `${row.formId}:${row.roundId}`;
    const group = groups.get(key) ?? {
      title: several ? `${row.formTitle}: ${row.roundName}` : row.formTitle,
      rows: [],
      order: row.roundOrdinal,
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.title.localeCompare(b.title) || a.order - b.order)
    .map(({ title, rows: groupRows }) => ({ title, rows: groupRows }));
}

function parseResults(rows: Json): ResultRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const text = (key: string) => (typeof row[key] === "string" ? String(row[key]) : "");
    const number = (key: string) => (typeof row[key] === "number" ? Number(row[key]) : null);
    return [
      {
        submissionId: text("submission_id"),
        title: text("title") || "Untitled",
        teamId: text("team_id"),
        teamName: text("team_name") || "A team",
        formId: text("form_id"),
        formTitle: text("form_title"),
        score: number("score"),
        rawScore: number("raw_score"),
        rank: number("rank") ?? 0,
        divisionRank: number("division_rank") ?? 0,
        divisionId: typeof row.division_id === "string" ? row.division_id : null,
        roundId: text("round_id"),
        roundOrdinal: number("round_ordinal") ?? 1,
        roundName: text("round_name") || "Round 1",
        judges: number("judges") ?? 0,
        conflicted: number("conflicted") ?? 0,
        method: text("method") || "rubric",
        rubric: text("rubric") || null,
        detail:
          row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
            ? row.detail
            : {},
      },
    ];
  });
}

export const previewResultsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<ResultRow[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("preview_results", { p_event: eventId });
    if (error) return toFailure(error, "ranking projects");
    return ok(parseResults(data));
  });

export const previewResultsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["results-preview", eventId] as const,
    queryFn: async () => unwrap(await previewResultsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const publishResultsFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("publish_results", { p_event: eventId });
    if (error) return toFailure(error, "publishing results");
    return ok(data.published_at);
  });

export interface PublishedResults {
  publishedAt: string;
  rows: ResultRow[];
  awards: Award[];
  feedback: { submissionId: string; body: string }[];
}

export const publishedResultsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<PublishedResults | null>> => {
    const supabase = createServerClient();
    const [publication, feedback] = await Promise.all([
      supabase
        .from("result_publications")
        .select("rows, awards, published_at")
        .eq("event_id", eventId)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("feedback")
        .select("submission_id, body_md")
        .eq("event_id", eventId)
        .eq("visibility", "team"),
    ]);
    const error = publication.error ?? feedback.error;
    if (error) return toFailure(error, "loading results");
    if (!publication.data) return ok(null);
    return ok({
      publishedAt: publication.data.published_at,
      rows: parseResults(publication.data.rows),
      awards: parseAwards(publication.data.awards),
      feedback: (feedback.data ?? []).map((row) => ({
        submissionId: row.submission_id,
        body: row.body_md,
      })),
    });
  });

export const publishedResultsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["results", eventId] as const,
    queryFn: async () => unwrap(await publishedResultsFn({ data: eventId })),
    retry: retryPolicy,
  });
