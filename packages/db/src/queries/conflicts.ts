import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json } from "../types.ts";
import { optionalId, requireId } from "./validate.ts";

export interface Conflict {
  judgeId: string;
  judgeName: string;
  teamId: string;
  teamName: string;
  reason: string;
}

export const eventConflictsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Conflict[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("judge_conflicts")
      .select("judge_id, team_id, reason, teams(name)")
      .eq("event_id", eventId);
    if (error) return toFailure(error, "loading conflicts");
    const judgeIds = [...new Set(data.map((row) => row.judge_id))];
    const { data: profiles } = judgeIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", judgeIds)
      : { data: [] };
    const names = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));
    return ok(
      data
        .map((row) => ({
          judgeId: row.judge_id,
          judgeName: names.get(row.judge_id) ?? "Judge",
          teamId: row.team_id,
          teamName: row.teams?.name ?? "A team",
          reason: row.reason,
        }))
        .sort(
          (a, b) => a.judgeName.localeCompare(b.judgeName) || a.teamName.localeCompare(b.teamName),
        ),
    );
  });

export const eventConflictsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["conflicts", eventId] as const,
    queryFn: async () => unwrap(await eventConflictsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const declareConflictFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; reason?: unknown };
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "",
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("declare_conflict", {
      p_submission: data.submissionId,
      p_reason: data.reason,
    });
    if (error) return toFailure(error, "recording your conflict");
    return ok(null);
  });

export interface ConflictItem {
  judgeId?: string;
  teamId?: string;
  email?: string;
  team?: string;
  reason: string;
}

export interface ConflictOutcome {
  recorded: number;
  unmatched: number;
}

export const setConflictsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; items?: unknown };
    if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 500) {
      throw new Error("Add between 1 and 500 conflicts");
    }
    const items = raw.items.map((entry: unknown): ConflictItem => {
      const item: Record<string, unknown> =
        entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : {};
      const judgeId = optionalId(item.judgeId, "judgeId");
      const teamId = optionalId(item.teamId, "teamId");
      return {
        ...(judgeId ? { judgeId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(typeof item.email === "string" ? { email: item.email.trim().slice(0, 320) } : {}),
        ...(typeof item.team === "string" ? { team: item.team.trim().slice(0, 60) } : {}),
        reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 500) : "",
      };
    });
    return { eventId: requireId(raw.eventId, "eventId"), items };
  })
  .handler(async ({ data }): Promise<DbResult<ConflictOutcome>> => {
    const supabase = createServerClient();
    const items: Json = data.items.map((item) => ({
      ...(item.judgeId ? { judge_id: item.judgeId } : {}),
      ...(item.teamId ? { team_id: item.teamId } : {}),
      ...(item.email ? { email: item.email } : {}),
      ...(item.team ? { team: item.team } : {}),
      reason: item.reason,
    }));
    const { data: rows, error } = await supabase.rpc("set_conflicts", {
      p_event: data.eventId,
      p_items: items,
    });
    if (error) return toFailure(error, "recording conflicts");
    const row = rows[0];
    const unmatched = Array.isArray(row?.unmatched) ? row.unmatched.length : 0;
    return ok({ recorded: row?.recorded ?? 0, unmatched });
  });

export const removeConflictFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; judgeId?: unknown; teamId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      judgeId: requireId(raw.judgeId, "judgeId"),
      teamId: requireId(raw.teamId, "teamId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("remove_conflict", {
      p_event: data.eventId,
      p_judge: data.judgeId,
      p_team: data.teamId,
    });
    if (error) return toFailure(error, "lifting the conflict");
    return ok(null);
  });

export interface JudgeCalibrationRow {
  judgeId: string;
  name: string;
  scores: number;
  entries: number;
  meanPct: number;
  sdPct: number;
}

export const judgeCalibrationFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<JudgeCalibrationRow[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("judge_calibration", { p_event: eventId });
    if (error) return toFailure(error, "reading how judges score");
    return ok(
      data.map((row) => ({
        judgeId: row.judge_id,
        name: row.name,
        scores: Number(row.scores),
        entries: Number(row.entries),
        meanPct: Number(row.mean_pct),
        sdPct: Number(row.sd_pct),
      })),
    );
  });

export const judgeCalibrationQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["judge-calibration", eventId] as const,
    queryFn: async () => unwrap(await judgeCalibrationFn({ data: eventId })),
    retry: retryPolicy,
  });
