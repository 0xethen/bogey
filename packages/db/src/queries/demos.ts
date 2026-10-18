import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { optionalId, requireId, requireNumber, requireText } from "./validate.ts";
import { profileNames } from "./profile-names.ts";

export interface DemoSlot {
  submissionId: string;
  title: string;
  teamName: string;
  table: string | null;
  position: number;
  /** When the slot starts, from the panel's start and slot length; null without a start. */
  startsAt: string | null;
}

export interface DemoPanel {
  id: string;
  roundId: string;
  name: string;
  location: string;
  startsAt: string | null;
  slotMinutes: number;
  nowPosition: number | null;
  judges: { id: string; name: string }[];
  slots: DemoSlot[];
}

/** A slot's start: back to back from the panel's start. */
export function slotStart(
  panel: { startsAt: string | null; slotMinutes: number },
  position: number,
): string | null {
  if (!panel.startsAt) return null;
  return new Date(Date.parse(panel.startsAt) + position * panel.slotMinutes * 60_000).toISOString();
}

export const demoPanelsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<DemoPanel[]>> => {
    const supabase = createServerClient();
    const [panels, judges, slots] = await Promise.all([
      supabase
        .from("judging_panels")
        .select("id, round_id, name, location, starts_at, slot_minutes, now_position, sort")
        .eq("event_id", eventId)
        .order("sort"),
      supabase.from("panel_judges").select("panel_id, judge_id").eq("event_id", eventId),
      supabase
        .from("panel_slots")
        .select("panel_id, submission_id, position, submissions(title, table_label, teams(name))")
        .eq("event_id", eventId)
        .order("position"),
    ]);
    const error = panels.error ?? judges.error ?? slots.error;
    if (error) return toFailure(error, "loading the demo schedule");
    const judgeRows = judges.data ?? [];
    const slotRows = slots.data ?? [];
    const { names, error: profileError } = await profileNames(
      supabase,
      judgeRows.map((row) => row.judge_id),
    );
    if (profileError) return toFailure(profileError, "loading the demo schedule");
    return ok(
      (panels.data ?? []).map((row) => {
        const panel = { startsAt: row.starts_at, slotMinutes: row.slot_minutes };
        return {
          id: row.id,
          roundId: row.round_id,
          name: row.name,
          location: row.location,
          startsAt: row.starts_at,
          slotMinutes: row.slot_minutes,
          nowPosition: row.now_position,
          judges: judgeRows
            .filter((judge) => judge.panel_id === row.id)
            .map((judge) => ({ id: judge.judge_id, name: names.get(judge.judge_id) ?? "Judge" }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          slots: slotRows
            .filter((slot) => slot.panel_id === row.id)
            .map((slot) => ({
              submissionId: slot.submission_id,
              title: slot.submissions?.title || "Untitled",
              teamName: slot.submissions?.teams?.name ?? "A team",
              table: slot.submissions?.table_label ?? null,
              position: slot.position,
              startsAt: slotStart(panel, slot.position),
            })),
        };
      }),
    );
  });

export const demoPanelsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["demo-panels", eventId] as const,
    queryFn: async () => unwrap(await demoPanelsFn({ data: eventId })),
    retry: retryPolicy,
  });

export interface PanelInput {
  id?: string;
  name: string;
  location: string;
  startsAt: string | null;
  slotMinutes: number;
  judges: string[];
}

export const savePanelsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { roundId?: unknown; panels?: unknown };
    if (!Array.isArray(raw.panels) || raw.panels.length > 50) throw new Error("Up to 50 panels");
    return {
      roundId: requireId(raw.roundId, "roundId"),
      panels: raw.panels.map((item: unknown): PanelInput => {
        const panel = (item ?? {}) as Record<string, unknown>;
        const startsAt = panel.startsAt;
        if (startsAt !== null && startsAt !== undefined && typeof startsAt !== "string") {
          throw new Error("Start must be a date");
        }
        if (!Array.isArray(panel.judges) || panel.judges.length > 50) {
          throw new Error("Up to 50 judges a panel");
        }
        return {
          id: optionalId(panel.id, "id"),
          name: requireText(panel.name, "Panel name", 60),
          location: typeof panel.location === "string" ? panel.location.slice(0, 120) : "",
          startsAt: startsAt ? startsAt : null,
          slotMinutes: Math.round(requireNumber(panel.slotMinutes, "Minutes a team", 1, 240)),
          judges: panel.judges.map((judge) => requireId(judge, "judge")),
        };
      }),
    };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: count, error } = await supabase.rpc("save_panels", {
      p_round: data.roundId,
      p_items: data.panels.map((panel) => ({
        id: panel.id ?? "",
        name: panel.name,
        location: panel.location,
        startsAt: panel.startsAt ?? "",
        slotMinutes: panel.slotMinutes,
        judges: panel.judges,
      })),
    });
    if (error) return toFailure(error, "saving the panels");
    return ok(count);
  });

/** Resolves to how many entries got a slot. */
export const scheduleDemosFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { roundId?: unknown; reset?: unknown };
    return { roundId: requireId(raw.roundId, "roundId"), reset: raw.reset === true };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: placed, error } = await supabase.rpc("schedule_demos", {
      p_round: data.roundId,
      p_reset: data.reset,
    });
    if (error) return toFailure(error, "scheduling the demos");
    return ok(placed);
  });

export const moveDemoFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      roundId?: unknown;
      submissionId?: unknown;
      panelId?: unknown;
      position?: unknown;
    };
    return {
      roundId: requireId(raw.roundId, "roundId"),
      submissionId: requireId(raw.submissionId, "submissionId"),
      panelId: requireId(raw.panelId, "panelId"),
      position:
        raw.position === undefined || raw.position === null
          ? undefined
          : Math.round(requireNumber(raw.position, "Position", 0, 10_000)),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("move_demo", {
      p_round: data.roundId,
      p_submission: data.submissionId,
      p_panel: data.panelId,
      ...(data.position === undefined ? {} : { p_position: data.position }),
    });
    if (error) return toFailure(error, "moving the team");
    return ok(null);
  });

/** Marks which slot is presenting; null before the first. */
export const setPanelNowFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { panelId?: unknown; position?: unknown };
    return {
      panelId: requireId(raw.panelId, "panelId"),
      position:
        raw.position === null || raw.position === undefined
          ? null
          : Math.round(requireNumber(raw.position, "Position", 0, 10_000)),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_panel_now", {
      p_panel: data.panelId,
      ...(data.position === null ? {} : { p_position: data.position }),
    });
    if (error) return toFailure(error, "moving to the next team");
    return ok(null);
  });

const mySlot = z.object({
  submissionId: z.string(),
  title: z.string(),
  roundName: z.string(),
  panelName: z.string(),
  location: z.string(),
  position: z.number(),
  startsAt: z.string().nullable(),
  /** Teams presenting before this one; null until the panel starts. */
  ahead: z.number().nullable(),
  /** The panel's judges, when the event shows them (judging.demoJudges). */
  judges: z.array(z.string()).catch([]),
});

export type MyDemoSlot = z.infer<typeof mySlot>;

export const myDemoSlotsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<MyDemoSlot[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("my_demo_slots", { p_event: eventId });
    if (error) return toFailure(error, "loading your demo slot");
    return ok(z.array(mySlot).catch([]).parse(data));
  });

export const myDemoSlotsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-demo-slots", eventId] as const,
    queryFn: async () => unwrap(await myDemoSlotsFn({ data: eventId })),
    retry: retryPolicy,
    // the panel moves along during demos; teams don't get realtime on it
    refetchInterval: 30_000,
  });

export interface OfflineScore {
  roundId: string;
  submissionId: string;
  score: number;
}

export const offlineScoresFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<OfflineScore[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("ranking_inputs")
      .select("round_id, submission_id, score")
      .eq("event_id", eventId)
      .eq("provider", "offline");
    if (error) return toFailure(error, "loading offline scores");
    return ok(
      (data ?? []).map((row) => ({
        roundId: row.round_id,
        submissionId: row.submission_id,
        score: Number(row.score),
      })),
    );
  });

export const offlineScoresQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["offline-scores", eventId] as const,
    queryFn: async () => unwrap(await offlineScoresFn({ data: eventId })),
    retry: retryPolicy,
  });

export const saveOfflineScoresFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { roundId?: unknown; scores?: unknown };
    if (!Array.isArray(raw.scores) || raw.scores.length > 2000) {
      throw new Error("Up to 2000 scores at a time");
    }
    return {
      roundId: requireId(raw.roundId, "roundId"),
      scores: raw.scores.map((item: unknown) => {
        const entry = (item ?? {}) as { submissionId?: unknown; score?: unknown };
        return {
          submissionId: requireId(entry.submissionId, "submissionId"),
          score:
            entry.score === null
              ? null
              : requireNumber(entry.score, "Score", -1_000_000, 1_000_000),
        };
      }),
    };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: count, error } = await supabase.rpc("save_offline_scores", {
      p_round: data.roundId,
      p_items: data.scores.map((entry) => ({ submission: entry.submissionId, score: entry.score })),
    });
    if (error) return toFailure(error, "saving the scores");
    return ok(count);
  });
