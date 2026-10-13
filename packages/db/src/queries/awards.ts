import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json } from "../types.ts";
import { AWARD_KINDS, type AwardDraft, type AwardKind } from "@bogey/utils/awards";
import { optionalId, requireId, requireOneOf, requireText } from "./validate.ts";

export interface Award {
  id: string;
  kind: AwardKind;
  label: string;
  place: number | null;
  submissionId: string;
  title: string;
  teamId: string | null;
  teamName: string;
  blurb: string | null;
  formId: string | null;
  trackId: string | null;
  divisionId: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  prize: string;
  note: string;
}

function kindOf(value: unknown): AwardKind {
  return AWARD_KINDS.find((kind) => kind === value) ?? "special";
}

export function parseAwards(raw: Json): Award[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const text = (key: string) => (typeof entry[key] === "string" ? String(entry[key]) : null);
    const id = text("id");
    const submissionId = text("submission_id");
    if (!id || !submissionId) return [];
    return [
      {
        id,
        kind: kindOf(entry.kind),
        label: text("label") ?? "Award",
        place: typeof entry.place === "number" ? entry.place : null,
        submissionId,
        title: text("title") || "Untitled",
        teamId: text("team_id"),
        teamName: text("team_name") ?? "A team",
        blurb: text("blurb"),
        formId: text("form_id"),
        trackId: text("track_id"),
        divisionId: text("division_id"),
        sponsorName: text("sponsor_name"),
        sponsorLogoUrl: text("sponsor_logo_url"),
        prize: text("prize_md") ?? "",
        note: text("note_md") ?? "",
      },
    ];
  });
}

export const draftAwardsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Award[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("awards")
      .select(
        "id, kind, label, place, submission_id, form_id, track_id, division_id, note_md, submissions(title, team_id, teams(name))",
      )
      .eq("event_id", eventId)
      .order("sort");
    if (error) return toFailure(error, "loading awards");
    return ok(
      data.map((row) => ({
        id: row.id,
        kind: kindOf(row.kind),
        label: row.label,
        place: row.place,
        submissionId: row.submission_id,
        title: row.submissions?.title || "Untitled",
        teamId: row.submissions?.team_id ?? null,
        teamName: row.submissions?.teams?.name ?? "A team",
        blurb: null,
        formId: row.form_id,
        trackId: row.track_id,
        divisionId: row.division_id,
        sponsorName: null,
        sponsorLogoUrl: null,
        prize: "",
        note: row.note_md,
      })),
    );
  });

export const draftAwardsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["awards", eventId] as const,
    queryFn: async () => unwrap(await draftAwardsFn({ data: eventId })),
    retry: retryPolicy,
  });

export type AwardInput = AwardDraft & { id?: string };

function toJson(award: AwardInput): Json {
  return {
    ...(award.id ? { id: award.id } : {}),
    kind: award.kind,
    label: award.label,
    place: award.place,
    submission_id: award.submissionId,
    form_id: award.formId,
    track_id: award.trackId,
    division_id: award.divisionId,
    note_md: award.note,
  };
}

export const saveAwardsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; awards?: unknown };
    if (!Array.isArray(raw.awards) || raw.awards.length > 200) {
      throw new Error("An event has at most 200 awards");
    }
    const awards = raw.awards.map((entry: unknown): AwardInput => {
      const item: Record<string, unknown> =
        entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : {};
      const id = optionalId(item.id, "id");
      return {
        ...(id ? { id } : {}),
        kind: requireOneOf(item.kind, AWARD_KINDS, "kind"),
        label: requireText(item.label, "Award name", 120),
        place:
          typeof item.place === "number" && Number.isInteger(item.place) && item.place >= 1
            ? item.place
            : null,
        submissionId: requireId(item.submissionId, "submissionId"),
        formId: optionalId(item.formId, "formId") ?? null,
        trackId: optionalId(item.trackId, "trackId") ?? null,
        divisionId: optionalId(item.divisionId, "divisionId") ?? null,
        note: typeof item.note === "string" ? item.note.slice(0, 1000) : "",
      };
    });
    return { eventId: requireId(raw.eventId, "eventId"), awards };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: removed, error } = await supabase.rpc("save_awards", {
      p_event: data.eventId,
      p_items: data.awards.map(toJson),
    });
    if (error) return toFailure(error, "saving awards");
    return ok(removed);
  });
