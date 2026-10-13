import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { excerpt } from "@bogey/utils/text";
import { createServerClient } from "../server.ts";
import { getOrgFn } from "../tenant.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { jsonRecord } from "../types.ts";
import { isWindowOpen, windowByKey } from "./windows.ts";
import type { TeamSubmission } from "./submissions.ts";
import { requireId, requireSlug } from "./validate.ts";

export interface GalleryEvent {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  orgName: string;
}

export interface GalleryProject {
  id: string;
  title: string;
  teamName: string | null;
  formId: string;
  divisionId: string | null;
  trackIds: string[];
  blurb: string | null;
}

export interface Gallery {
  event: GalleryEvent;
  projects: GalleryProject[];
  forms: { id: string; title: string }[];
  tracks: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
}

const WRITTEN = new Set(["text", "longtext", "markdown"]);

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
    const [projects, forms, items, tracks, divisions] = await Promise.all([
      supabase
        .from("submissions")
        .select(
          "id, title, form_id, answers, teams(name, division_id), submission_tracks(track_id)",
        )
        .eq("event_id", event.id)
        .eq("status", "submitted")
        .eq("is_public", true)
        .order("submitted_at", { ascending: false }),
      supabase.from("submission_forms").select("id, title").eq("event_id", event.id).order("sort"),
      supabase
        .from("submission_items")
        .select("form_id, key, kind")
        .eq("event_id", event.id)
        .order("sort"),
      supabase.from("tracks").select("id, name").eq("event_id", event.id).order("sort"),
      supabase.from("divisions").select("id, name").eq("event_id", event.id).order("sort"),
    ]);
    const error = projects.error ?? forms.error ?? items.error ?? tracks.error ?? divisions.error;
    if (error) return toFailure(error, "loading the gallery");

    const written = (items.data ?? []).filter((item) => WRITTEN.has(item.kind));
    return ok({
      event,
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
