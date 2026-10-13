import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Tables } from "../types.ts";
import { attachmentsSchema, type MessageAttachment } from "./messages.ts";
import { requireId, requireOneOf, requireText } from "./validate.ts";

export type AnnouncementSeverity = Enums<"announcement_severity">;
type EventRole = Enums<"event_role">;

export type AnnouncementTarget =
  | { kind: "role"; role: EventRole; label: string }
  | { kind: "division"; id: string; label: string }
  | { kind: "team"; id: string; label: string };

export interface Announcement extends Omit<Tables<"announcements">, "attachments"> {
  attachments: MessageAttachment[];
  audience: AnnouncementTarget[];
  authorName: string | null;
  read: boolean;
  scheduled: boolean;
}

const SEVERITIES: Tuple<AnnouncementSeverity> = ["info", "warning", "urgent"];
export const AUDIENCE_ROLES: Tuple<{ role: EventRole; label: string }> = [
  { role: "participant", label: "Participants" },
  { role: "judge", label: "Judges" },
  { role: "staff", label: "Staff" },
];
const ROLE_LABEL = new Map(AUDIENCE_ROLES.map((item) => [item.role, item.label]));

export const eventAnnouncementsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; scope?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      scope: requireOneOf(raw.scope ?? "published", ["published", "all"], "scope"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<Announcement[]>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    let query = supabase
      .from("announcements")
      .select("*, announcement_audiences(role, division_id, team_id, divisions(name), teams(name))")
      .eq("event_id", data.eventId)
      .is("deleted_at", null)
      .order("publish_at", { ascending: false })
      .limit(200);
    if (data.scope === "published") query = query.lte("publish_at", new Date().toISOString());
    const { data: rows, error } = await query;
    if (error) return toFailure(error, "loading announcements");

    const ids = rows.map((row) => row.id);
    const authorIds = [...new Set(rows.flatMap((row) => (row.author_id ? [row.author_id] : [])))];
    const [reads, authors] = await Promise.all([
      userId && ids.length
        ? supabase
            .from("announcement_reads")
            .select("announcement_id")
            .eq("user_id", userId)
            .in("announcement_id", ids)
        : Promise.resolve({ data: [], error: null }),
      authorIds.length
        ? supabase.from("profiles").select("id, display_name").in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const failure = reads.error ?? authors.error;
    if (failure) return toFailure(failure, "loading announcements");

    const seen = new Set((reads.data ?? []).map((row) => row.announcement_id));
    const names = new Map((authors.data ?? []).map((row) => [row.id, row.display_name]));
    const now = Date.now();
    return ok(
      rows.map(({ announcement_audiences: targets, ...row }) => ({
        ...row,
        attachments: attachmentsSchema.catch([]).parse(row.attachments),
        audience: targets.flatMap((target): AnnouncementTarget[] => {
          if (target.role) {
            return [{ kind: "role", role: target.role, label: ROLE_LABEL.get(target.role) ?? "" }];
          }
          if (target.division_id) {
            const label = target.divisions?.name ?? "Division";
            return [{ kind: "division", id: target.division_id, label }];
          }
          if (target.team_id) {
            return [{ kind: "team", id: target.team_id, label: target.teams?.name ?? "Team" }];
          }
          return [];
        }),
        authorName: row.author_id ? (names.get(row.author_id) ?? null) : null,
        read: seen.has(row.id) || new Date(row.publish_at).getTime() > now,
        scheduled: new Date(row.publish_at).getTime() > now,
      })),
    );
  });

export const eventAnnouncementsQueryOptions = (
  eventId: string,
  scope: "published" | "all" = "published",
) =>
  queryOptions({
    queryKey: ["announcements", eventId, scope] as const,
    queryFn: async () => unwrap(await eventAnnouncementsFn({ data: { eventId, scope } })),
    retry: retryPolicy,
  });

export const markAnnouncementsReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { ids?: unknown };
    if (!Array.isArray(raw.ids) || raw.ids.length > 200) throw new Error("ids must be a list");
    return { ids: raw.ids.map((id) => requireId(id, "id")) };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    if (data.ids.length === 0) return ok(null);
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return fail("forbidden", "Sign in first.");
    const { error } = await supabase.from("announcement_reads").upsert(
      data.ids.map((id) => ({ announcement_id: id, user_id: userId })),
      { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
    );
    if (error) return toFailure(error, "marking announcements read");
    return ok(null);
  });

export interface NewAnnouncement {
  eventId: string;
  /** Picked up front so files can be uploaded to the announcement's folder first. */
  id: string | null;
  attachments: MessageAttachment[];
  title: string;
  bodyMd: string;
  severity: AnnouncementSeverity;
  audience: string[];
  publishAt: string | null;
  anonymous: boolean;
  notify: boolean;
}

const ROLES: Tuple<EventRole> = AUDIENCE_ROLES.map((item) => item.role);

export function parseAudience(keys: Tuple<string>) {
  const roles: EventRole[] = [];
  const divisions: string[] = [];
  const teams: string[] = [];
  for (const key of keys) {
    const [kind, value] = key.split(":", 2);
    if (kind === "role") roles.push(requireOneOf(value, ROLES, "Audience"));
    else if (kind === "division") divisions.push(requireId(value, "Division"));
    else if (kind === "team") teams.push(requireId(value, "Team"));
    else throw new Error("Audience must be a role, division or team.");
  }
  return { roles, divisions, teams };
}

export const postAnnouncementFn = createServerFn({ method: "POST" })
  .validator((input: unknown): NewAnnouncement => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const publishAt =
      typeof raw.publishAt === "string" && !Number.isNaN(Date.parse(raw.publishAt))
        ? raw.publishAt
        : null;
    const audience = Array.isArray(raw.audience) ? raw.audience : [];
    if (audience.length > 200) throw new Error("Pick fewer than 200 groups.");
    const attachments = attachmentsSchema.safeParse(raw.attachments ?? []);
    if (!attachments.success) throw new Error("Those attachments can't be posted.");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      id: raw.id === undefined || raw.id === null ? null : requireId(raw.id, "id"),
      attachments: attachments.data,
      title: requireText(raw.title, "Title", 140),
      bodyMd: typeof raw.bodyMd === "string" ? raw.bodyMd.slice(0, 20_000) : "",
      severity: requireOneOf(raw.severity, SEVERITIES, "Severity"),
      audience: audience.map((key) => (typeof key === "string" ? key : "")),
      publishAt,
      anonymous: raw.anonymous === true,
      notify: raw.notify === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const { roles, divisions, teams } = parseAudience(data.audience);
    const supabase = createServerClient();
    const { data: id, error } = await supabase.rpc("post_announcement", {
      p_event: data.eventId,
      p_title: data.title,
      p_body: data.bodyMd,
      p_severity: data.severity,
      p_publish_at: data.publishAt ?? undefined,
      p_roles: roles,
      p_divisions: divisions,
      p_teams: teams,
      ...(data.anonymous ? { p_anonymous: true } : {}),
      ...(data.notify ? { p_notify: true } : {}),
      ...(data.id ? { p_id: data.id } : {}),
      ...(data.attachments.length
        ? {
            p_attachments: data.attachments.map(({ path, name, size, type }) => ({
              path,
              name,
              size,
              type,
            })),
          }
        : {}),
    });
    if (error) return toFailure(error, "posting the announcement");
    return ok(id);
  });

export interface AudienceChoices {
  divisions: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}

export const audienceChoicesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<AudienceChoices>> => {
    const supabase = createServerClient();
    const [divisions, teams] = await Promise.all([
      supabase.from("divisions").select("id, name").eq("event_id", eventId).order("sort"),
      supabase.from("teams").select("id, name").eq("event_id", eventId).order("name"),
    ]);
    const failure = divisions.error ?? teams.error;
    if (failure) return toFailure(failure, "loading divisions and teams");
    return ok({ divisions: divisions.data ?? [], teams: teams.data ?? [] });
  });

export const audienceChoicesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["announcement-audience", eventId] as const,
    queryFn: async () => unwrap(await audienceChoicesFn({ data: eventId })),
    retry: retryPolicy,
  });

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from("announcements")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) return toFailure(error, "deleting the announcement");
    if (!rows.length) return fail("forbidden", "Only organizers can delete announcements.");
    return ok(null);
  });

export const announcementsTopic = (eventId: string) => `announcements:${eventId}`;
