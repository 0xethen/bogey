import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json } from "../types.ts";
import { optionalId, optionalText, requireId, requireNumber, requireText } from "./validate.ts";

export interface Prize {
  id: string;
  name: string;
  description: string;
  prize: string;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  maxWinners: number;
  optIn: boolean;
  formId: string | null;
}

export const eventPrizesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Prize[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("tracks")
      .select(
        "id, name, description_md, prize_md, sponsor_name, sponsor_logo_url, max_winners, opt_in, form_id",
      )
      .eq("event_id", eventId)
      .order("sort");
    if (error) return toFailure(error, "loading prizes");
    return ok(
      data.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description_md,
        prize: row.prize_md,
        sponsorName: row.sponsor_name,
        sponsorLogoUrl: row.sponsor_logo_url,
        maxWinners: row.max_winners,
        optIn: row.opt_in,
        formId: row.form_id,
      })),
    );
  });

export const eventPrizesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["prizes", eventId] as const,
    queryFn: async () => unwrap(await eventPrizesFn({ data: eventId })),
    retry: retryPolicy,
  });

export type PrizeDraft = Omit<Prize, "id"> & { id?: string };

function readDraft(entry: unknown): PrizeDraft {
  const raw: Record<string, unknown> =
    entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : {};
  const id = optionalId(raw.id, "id");
  return {
    ...(id ? { id } : {}),
    name: requireText(raw.name, "Prize name", 80),
    description: typeof raw.description === "string" ? raw.description.slice(0, 5000) : "",
    prize: typeof raw.prize === "string" ? raw.prize.slice(0, 2000) : "",
    sponsorName: optionalText(raw.sponsorName, "Sponsor", 80),
    sponsorLogoUrl: optionalText(raw.sponsorLogoUrl, "Logo", 500),
    maxWinners: Math.round(requireNumber(raw.maxWinners ?? 1, "Winners", 1, 20)),
    optIn: raw.optIn !== false,
    formId: optionalId(raw.formId, "formId") ?? null,
  };
}

function toJson(prize: PrizeDraft): Json {
  return {
    ...(prize.id ? { id: prize.id } : {}),
    name: prize.name,
    description_md: prize.description,
    prize_md: prize.prize,
    sponsor_name: prize.sponsorName,
    sponsor_logo_url: prize.sponsorLogoUrl,
    max_winners: prize.maxWinners,
    opt_in: prize.optIn,
    form_id: prize.formId,
  };
}

export const savePrizesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; prizes?: unknown };
    if (!Array.isArray(raw.prizes) || raw.prizes.length > 40) {
      throw new Error("An event has at most 40 prizes");
    }
    const prizes = raw.prizes.map(readDraft);
    const names = new Set(prizes.map((prize) => prize.name.toLowerCase()));
    if (names.size !== prizes.length) throw new Error("Two prizes have the same name");
    return { eventId: requireId(raw.eventId, "eventId"), prizes };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: removed, error } = await supabase.rpc("save_prizes", {
      p_event: data.eventId,
      p_items: data.prizes.map(toJson),
    });
    if (error) return toFailure(error, "saving prizes");
    return ok(removed);
  });

export const setSubmissionTracksFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; tracks?: unknown };
    if (!Array.isArray(raw.tracks) || raw.tracks.length > 40) throw new Error("Too many prizes");
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      tracks: raw.tracks.map((track) => requireId(track, "track")),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_submission_tracks", {
      p_submission: data.submissionId,
      p_tracks: data.tracks,
    });
    if (error) return toFailure(error, "choosing prizes");
    return ok(null);
  });

export const submissionTracksFn = createServerFn({ method: "GET" })
  .validator((submissionId: unknown) => requireId(submissionId, "submissionId"))
  .handler(async ({ data: submissionId }): Promise<DbResult<string[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("submission_tracks")
      .select("track_id")
      .eq("submission_id", submissionId);
    if (error) return toFailure(error, "loading the prizes entered");
    return ok(data.map((row) => row.track_id));
  });

export const submissionTracksQueryOptions = (submissionId: string) =>
  queryOptions({
    queryKey: ["submission-tracks", submissionId] as const,
    queryFn: async () => unwrap(await submissionTracksFn({ data: submissionId })),
    retry: retryPolicy,
  });

export const eventEntriesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(
    async ({ data: eventId }): Promise<DbResult<{ trackId: string; submissionId: string }[]>> => {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from("submission_tracks")
        .select("track_id, submission_id")
        .eq("event_id", eventId);
      if (error) return toFailure(error, "loading prize entries");
      return ok(data.map((row) => ({ trackId: row.track_id, submissionId: row.submission_id })));
    },
  );

export const eventEntriesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["prize-entries", eventId] as const,
    queryFn: async () => unwrap(await eventEntriesFn({ data: eventId })),
    retry: retryPolicy,
  });
