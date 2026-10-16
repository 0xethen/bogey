import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId, requireText } from "./validate.ts";

export interface JudgingFlag {
  id: string;
  submissionId: string;
  title: string;
  roundId: string;
  /** Empty when the flag came from a score gap. */
  reason: string;
  /** Points out of 100 between judges' totals, for a flag raised on its own. */
  gap: number | null;
  raisedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string;
}

type Client = ReturnType<typeof createServerClient>;

async function names(supabase: Client, ids: Tuple<string | null>) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const { data } = wanted.length
    ? await supabase.from("profiles").select("id, display_name").in("id", wanted)
    : { data: [] };
  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

const FLAG_COLUMNS =
  "id, submission_id, round_id, reason, gap, raised_by, created_at, resolved_at, resolved_by, resolution, submissions(title)";

export const eventFlagsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<JudgingFlag[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("judging_flags")
      .select(FLAG_COLUMNS)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return toFailure(error, "loading flagged projects");
    const people = await names(
      supabase,
      data.flatMap((row) => [row.raised_by, row.resolved_by]),
    );
    return ok(
      data.map((row) => ({
        id: row.id,
        submissionId: row.submission_id,
        title: row.submissions?.title || "Untitled",
        roundId: row.round_id,
        reason: row.reason,
        gap: row.gap === null ? null : Number(row.gap),
        raisedBy: row.raised_by ? (people.get(row.raised_by) ?? "A judge") : null,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by ? (people.get(row.resolved_by) ?? "A judge") : null,
        resolution: row.resolution,
      })),
    );
  });

export const eventFlagsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["judging-flags", eventId] as const,
    queryFn: async () => unwrap(await eventFlagsFn({ data: eventId })),
    retry: retryPolicy,
  });

export interface DeliberationNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface JudgeScores {
  judgeId: string;
  name: string;
  scores: { [criterionId: string]: number };
  note: string | null;
}

export interface Deliberation {
  flag: JudgingFlag;
  notes: DeliberationNote[];
  /** Every judge's scores and notes this round; filled only while the flag is open. */
  judges: JudgeScores[];
}

export const deliberationFn = createServerFn({ method: "GET" })
  .validator((submissionId: unknown) => requireId(submissionId, "submissionId"))
  .handler(async ({ data: submissionId }): Promise<DbResult<Deliberation | null>> => {
    const supabase = createServerClient();
    const { data: flag, error } = await supabase
      .from("judging_flags")
      .select(FLAG_COLUMNS)
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return toFailure(error, "loading the deliberation");
    if (!flag) return ok(null);
    const open = flag.resolved_at === null;
    const [notes, scores, feedback] = await Promise.all([
      supabase
        .from("deliberation_notes")
        .select("id, author_id, body_md, created_at")
        .eq("flag_id", flag.id)
        .order("created_at"),
      open
        ? supabase
            .from("scores")
            .select("judge_id, criterion_id, value")
            .eq("submission_id", submissionId)
            .eq("round_id", flag.round_id)
        : Promise.resolve({ data: [], error: null }),
      open
        ? supabase
            .from("feedback")
            .select("judge_id, body_md")
            .eq("submission_id", submissionId)
            .eq("round_id", flag.round_id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const failure = notes.error ?? scores.error ?? feedback.error;
    if (failure) return toFailure(failure, "loading the deliberation");
    const people = await names(supabase, [
      flag.raised_by,
      flag.resolved_by,
      ...(notes.data ?? []).map((row) => row.author_id),
      ...(scores.data ?? []).map((row) => row.judge_id),
    ]);
    const judges = new Map<string, JudgeScores>();
    for (const row of scores.data ?? []) {
      const judge = judges.get(row.judge_id) ?? {
        judgeId: row.judge_id,
        name: people.get(row.judge_id) ?? "Judge",
        scores: {},
        note: null,
      };
      judge.scores[row.criterion_id] = Number(row.value);
      judges.set(row.judge_id, judge);
    }
    for (const row of feedback.data ?? []) {
      const judge = judges.get(row.judge_id);
      if (judge) judge.note = row.body_md;
    }
    return ok({
      flag: {
        id: flag.id,
        submissionId: flag.submission_id,
        title: flag.submissions?.title || "Untitled",
        roundId: flag.round_id,
        reason: flag.reason,
        gap: flag.gap === null ? null : Number(flag.gap),
        raisedBy: flag.raised_by ? (people.get(flag.raised_by) ?? "A judge") : null,
        createdAt: flag.created_at,
        resolvedAt: flag.resolved_at,
        resolvedBy: flag.resolved_by ? (people.get(flag.resolved_by) ?? "A judge") : null,
        resolution: flag.resolution,
      },
      notes: (notes.data ?? []).map((row) => ({
        id: row.id,
        author: row.author_id ? (people.get(row.author_id) ?? "A judge") : "A judge",
        body: row.body_md,
        createdAt: row.created_at,
      })),
      judges: [...judges.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

export const deliberationQueryOptions = (submissionId: string) =>
  queryOptions({
    queryKey: ["deliberation", submissionId] as const,
    queryFn: async () => unwrap(await deliberationFn({ data: submissionId })),
    retry: retryPolicy,
  });

export const flagSubmissionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; reason?: unknown };
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      reason: requireText(raw.reason, "Reason", 500),
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: id, error } = await supabase.rpc("flag_submission", {
      p_submission: data.submissionId,
      p_reason: data.reason,
    });
    if (error) return toFailure(error, "flagging the project");
    return ok(id);
  });

export const resolveFlagFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { flagId?: unknown; resolution?: unknown };
    return {
      flagId: requireId(raw.flagId, "flagId"),
      resolution: typeof raw.resolution === "string" ? raw.resolution.trim().slice(0, 2000) : "",
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("resolve_flag", {
      p_flag: data.flagId,
      p_resolution: data.resolution,
    });
    if (error) return toFailure(error, "resolving the flag");
    return ok(null);
  });

export const addDeliberationNoteFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { flagId?: unknown; body?: unknown };
    return {
      flagId: requireId(raw.flagId, "flagId"),
      body: requireText(raw.body, "Note", 5000),
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: id, error } = await supabase.rpc("add_deliberation_note", {
      p_flag: data.flagId,
      p_body: data.body,
    });
    if (error) return toFailure(error, "adding the note");
    return ok(id);
  });
