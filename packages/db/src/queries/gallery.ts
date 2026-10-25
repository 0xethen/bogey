import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { excerpt } from "@bogey/utils/text";
import { resolveSettings, type ResolvedValue } from "@bogey/config/settings";
import { publicSupabaseUrl } from "../env.ts";
import { createServerClient } from "../server.ts";
import { getOrgFn } from "../tenant.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { jsonRecord } from "../types.ts";
import { parseAwards } from "./awards.ts";
import { isWindowOpen, windowByKey } from "./windows.ts";
import type { TeamSubmission } from "./submissions.ts";
import { requireId, requireOneOf, requireSlug, requireText } from "./validate.ts";

export interface GalleryEvent {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  orgName: string;
}

export const CARD_SIZES = ["compact", "standard", "large"] as const;
export type CardSize = (typeof CARD_SIZES)[number];

export interface GalleryWin {
  label: string;
  place: number | null;
}

export interface GalleryProject {
  id: string;
  title: string;
  teamName: string | null;
  formId: string;
  divisionId: string | null;
  trackIds: string[];
  blurb: string | null;
  submittedAt: string | null;
  /** A short-lived link to the project's banner image, when it has one and banners are on. */
  bannerUrl: string | null;
  cardSize: CardSize;
  wins: GalleryWin[];
}

export type GallerySettings = ResolvedValue<"gallery">;

export interface Gallery {
  event: GalleryEvent;
  settings: GallerySettings;
  projects: GalleryProject[];
  forms: { id: string; title: string }[];
  tracks: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
}

const WRITTEN = new Set(["text", "longtext", "markdown"]);
const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
/** Banner links last an hour; the gallery query is refreshed before then. */
const BANNER_SECONDS = 3600;

function cardSize(value: string): CardSize {
  return CARD_SIZES.find((size) => size === value) ?? "standard";
}

async function openGalleryEvent(slug: string): Promise<DbResult<GalleryEvent | null>> {
  const org = await getOrgFn();
  if (!org.ok) return org;
  if (!org.data) return ok(null);
  const supabase = createServerClient();
  const { data: event, error } = await supabase
    .from("events")
    .select("id, name, slug, timezone, visibility, event_windows(*)")
    .eq("org_id", org.data.id)
    .eq("slug", slug)
    .maybeSingle();
  if (error) return toFailure(error, "loading the gallery");
  if (!event || event.visibility !== "public") return ok(null);
  if (!isWindowOpen(windowByKey(event.event_windows, "gallery"))) return ok(null);
  return ok({
    id: event.id,
    name: event.name,
    slug: String(event.slug),
    timezone: event.timezone,
    orgName: org.data.name,
  });
}

export const galleryFn = createServerFn({ method: "GET" })
  .validator((slug: unknown) => requireSlug(slug, "slug"))
  .handler(async ({ data: slug }): Promise<DbResult<Gallery | null>> => {
    const found = await openGalleryEvent(slug);
    if (!found.ok || !found.data) return found.ok ? ok(null) : found;
    const event = found.data;
    const supabase = createServerClient();
    const [projects, forms, items, tracks, divisions, rawSettings, files, publication] =
      await Promise.all([
        supabase
          .from("submissions")
          .select(
            "id, title, form_id, answers, submitted_at, card_size, teams(name, division_id), submission_tracks(track_id)",
          )
          .eq("event_id", event.id)
          .eq("status", "submitted")
          .eq("is_public", true)
          .order("submitted_at", { ascending: false }),
        supabase
          .from("submission_forms")
          .select("id, title")
          .eq("event_id", event.id)
          .order("sort"),
        supabase
          .from("submission_items")
          .select("form_id, key, kind")
          .eq("event_id", event.id)
          .order("sort"),
        supabase.from("tracks").select("id, name").eq("event_id", event.id).order("sort"),
        supabase.from("divisions").select("id, name").eq("event_id", event.id).order("sort"),
        supabase.rpc("settings_for", { p_namespaces: ["gallery"], p_event: event.id }),
        supabase
          .from("submission_files")
          .select("id, submission_id, storage_path, file_name, is_banner")
          .eq("event_id", event.id)
          .order("is_banner", { ascending: false })
          .order("sort")
          .order("created_at"),
        supabase
          .from("result_publications")
          .select("awards")
          .eq("event_id", event.id)
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    const error =
      projects.error ??
      forms.error ??
      items.error ??
      tracks.error ??
      divisions.error ??
      rawSettings.error ??
      files.error;
    if (error) return toFailure(error, "loading the gallery");
    const settings = resolveSettings("gallery", jsonRecord(rawSettings.data).gallery);

    // a team's chosen banner, else its first image; none at all when banners are off
    const bannerFiles = new Map<string, { id: string; path: string }>();
    if (settings.banners) {
      for (const file of files.data ?? []) {
        if (!IMAGE.test(file.file_name) || bannerFiles.has(file.submission_id)) continue;
        if (!settings.teamBanners && file.is_banner) continue;
        bannerFiles.set(file.submission_id, { id: file.id, path: file.storage_path });
      }
      if (!settings.teamBanners) {
        for (const file of files.data ?? []) {
          if (IMAGE.test(file.file_name) && !bannerFiles.has(file.submission_id)) {
            bannerFiles.set(file.submission_id, { id: file.id, path: file.storage_path });
          }
        }
      }
    }
    const signed = bannerFiles.size
      ? await supabase.storage.from("submissions").createSignedUrls(
          [...bannerFiles.values()].map((file) => file.path),
          BANNER_SECONDS,
        )
      : null;
    const urlByPath = new Map(
      (signed?.data ?? []).flatMap((entry) =>
        entry.path && entry.signedUrl
          ? [[entry.path, publicSupabaseUrl(entry.signedUrl)] as const]
          : [],
      ),
    );
    const wins = new Map<string, GalleryWin[]>();
    if (settings.winners) {
      for (const award of parseAwards(publication.data?.awards ?? [])) {
        wins.set(award.submissionId, [
          ...(wins.get(award.submissionId) ?? []),
          { label: award.label, place: award.place },
        ]);
      }
    }

    const written = (items.data ?? []).filter((item) => WRITTEN.has(item.kind));
    return ok({
      event,
      settings,
      projects: (projects.data ?? []).map((row) => {
        const answers = jsonRecord(row.answers);
        const first = written
          .filter((item) => item.form_id === row.form_id)
          .map((item) => answers[item.key])
          .find((value): value is string => typeof value === "string" && !!value.trim());
        return {
          id: row.id,
          title: row.title || "Untitled",
          teamName: row.teams?.name ?? null,
          formId: row.form_id,
          divisionId: row.teams?.division_id ?? null,
          trackIds: row.submission_tracks.map((link) => link.track_id),
          blurb: first ? excerpt(first) : null,
          submittedAt: row.submitted_at,
          bannerUrl: urlByPath.get(bannerFiles.get(row.id)?.path ?? "") ?? null,
          cardSize: cardSize(row.card_size),
          wins: wins.get(row.id) ?? [],
        };
      }),
      forms: forms.data ?? [],
      tracks: tracks.data ?? [],
      divisions: divisions.data ?? [],
    });
  });

export const galleryQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["gallery", slug] as const,
    queryFn: async () => unwrap(await galleryFn({ data: slug })),
    retry: retryPolicy,
    // banner links are signed for an hour
    staleTime: 30 * 60_000,
  });

export const galleryProjectFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { slug?: unknown; id?: unknown };
    return { slug: requireSlug(raw.slug, "slug"), id: requireId(raw.id, "id") };
  })
  .handler(async ({ data }): Promise<DbResult<TeamSubmission | null>> => {
    const found = await openGalleryEvent(data.slug);
    if (!found.ok) return found;
    if (!found.data) return fail("not_found", "This gallery isn't open.");
    const supabase = createServerClient();
    const { data: row, error } = await supabase
      .from("submissions")
      .select("*, teams(name), submission_files(*)")
      .eq("id", data.id)
      .eq("event_id", found.data.id)
      .eq("status", "submitted")
      .eq("is_public", true)
      .maybeSingle();
    if (error) return toFailure(error, "loading the project");
    if (!row) return ok(null);
    const { teams, submission_files, ...submission } = row;
    return ok({ ...submission, teamName: teams?.name ?? "A team", files: submission_files });
  });

export const galleryProjectQueryOptions = (slug: string, id: string) =>
  queryOptions({
    queryKey: ["gallery", slug, id] as const,
    queryFn: async () => unwrap(await galleryProjectFn({ data: { slug, id } })),
    retry: retryPolicy,
  });

export interface GalleryEngagement {
  submissionId: string;
  likes: number;
  comments: number;
}

export const galleryEngagementFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<GalleryEngagement[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("gallery_engagement", { p_event: eventId });
    if (error) return toFailure(error, "loading likes and comments");
    return ok(
      data.map((row) => ({
        submissionId: row.submission_id,
        likes: Number(row.likes),
        comments: Number(row.comments),
      })),
    );
  });

export const galleryEngagementQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["gallery-engagement", eventId] as const,
    queryFn: async () => unwrap(await galleryEngagementFn({ data: eventId })),
    retry: retryPolicy,
  });

export const myLikesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<string[]>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return ok([]);
    const { data, error } = await supabase
      .from("gallery_likes")
      .select("submission_id")
      .eq("event_id", eventId)
      .eq("user_id", userData.user.id);
    if (error) return toFailure(error, "loading your likes");
    return ok(data.map((row) => row.submission_id));
  });

export const myLikesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-likes", eventId] as const,
    queryFn: async () => unwrap(await myLikesFn({ data: eventId })),
    retry: retryPolicy,
  });

export const setLikeFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; like?: unknown };
    return { submissionId: requireId(raw.submissionId, "submissionId"), like: raw.like !== false };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_gallery_like", {
      p_submission: data.submissionId,
      p_like: data.like,
    });
    if (error) return toFailure(error, "liking the project");
    return ok(null);
  });

export interface GalleryComment {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
}

export const galleryThreadFn = createServerFn({ method: "GET" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<GalleryComment[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("gallery_thread", { p_submission: id });
    if (error) return toFailure(error, "loading comments");
    return ok(
      data.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        authorId: row.author_id,
        authorName: row.author_name,
      })),
    );
  });

export const galleryThreadQueryOptions = (submissionId: string) =>
  queryOptions({
    queryKey: ["gallery-thread", submissionId] as const,
    queryFn: async () => unwrap(await galleryThreadFn({ data: submissionId })),
    retry: retryPolicy,
  });

export const postCommentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; body?: unknown };
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      body: requireText(raw.body, "Comment", 1000),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("post_gallery_comment", {
      p_submission: data.submissionId,
      p_body: data.body,
    });
    if (error) return toFailure(error, "posting your comment");
    return ok(null);
  });

export const deleteCommentFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("delete_gallery_comment", { p_comment: id });
    if (error) return toFailure(error, "removing the comment");
    return ok(null);
  });

/** Sets how a team's project looks in the gallery: its banner image (a file's id, or none) and card size. */
export const setGalleryLookFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; bannerId?: unknown; size?: unknown };
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      bannerId: raw.bannerId ? requireId(raw.bannerId, "bannerId") : null,
      size: requireOneOf(raw.size, CARD_SIZES, "Card size"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_gallery_look", {
      p_submission: data.submissionId,
      ...(data.bannerId ? { p_banner: data.bannerId } : {}),
      p_size: data.size,
    });
    if (error) return toFailure(error, "saving how your project looks");
    return ok(null);
  });
