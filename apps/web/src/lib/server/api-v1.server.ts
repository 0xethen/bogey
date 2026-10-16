import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { createAnonClient } from "@bogey/db/anon";
import type { Json } from "@bogey/db/types";
import { hackathonJson, toAtom, toRss, type Feed } from "@bogey/utils/feeds";
import { toIcal, type CalendarEntry } from "@bogey/utils/ical";
import { SLUG } from "@bogey/utils/keys";

type Client = ReturnType<typeof createAnonClient>;

interface Context {
  supabase: Client;
  org: { id: string; slug: string; name: string };
  origin: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const CACHE = "public, max-age=60, stale-while-revalidate=300";

function reply(body: string, contentType: string, cache = CACHE): Response {
  return new Response(body, {
    headers: { ...CORS, "Content-Type": contentType, "Cache-Control": cache },
  });
}

function json(data: unknown, cache = CACHE): Response {
  return reply(JSON.stringify(data), "application/json; charset=utf-8", cache);
}

function failure(status: 400 | 404 | 500, message: string): Response {
  return new Response(JSON.stringify({ error: { status, message } }), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

function requestHost(): string {
  return (getRequestHeader("x-forwarded-host") ?? getRequestHeader("host") ?? "")
    .split(",")[0]!
    .trim()
    .toLowerCase();
}

function requestOrigin(request: Request): string {
  const proto = (
    getRequestHeader("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")
  )
    .split(",")[0]!
    .trim();
  return `${proto === "http" ? "http" : "https"}://${requestHost()}`;
}

async function context(request: Request): Promise<Context | Response> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .rpc("org_for_host", { p_host: requestHost() })
    .maybeSingle();
  if (error) return failure(500, "Couldn't work out which organization this is.");
  if (!data) return failure(404, "There is no organization at this address.");
  return {
    supabase,
    org: { id: data.id, slug: String(data.slug), name: data.name },
    origin: requestOrigin(request),
  };
}

interface EventRow {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  kind: string;
  /** About, when the event shares it before approval (privacy.about); empty otherwise. */
  about: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
}

const EVENT_COLUMNS = "id, slug, name, short_name, kind, starts_at, ends_at, timezone";

function eventJson(origin: string, row: EventRow) {
  return {
    slug: row.slug,
    name: row.name,
    shortName: row.short_name,
    kind: row.kind,
    description: row.about,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    url: `${origin}/events/${row.slug}`,
  };
}

// settings RLS only returns an event's About when privacy.about shares it
async function withAbout<T extends { id: string }>(
  ctx: Context,
  rows: Tuple<T>,
): Promise<(T & { about: string })[] | null> {
  if (rows.length === 0) return [];
  const { data, error } = await ctx.supabase
    .from("settings")
    .select("event_id, value")
    .eq("scope", "event")
    .eq("namespace", "about")
    .in(
      "event_id",
      rows.map((row) => row.id),
    );
  if (error) return null;
  const about = new Map(
    data.map((row) => [row.event_id, aboutBody.catch({}).parse(row.value).body ?? ""]),
  );
  return rows.map((row) => ({ ...row, about: about.get(row.id) ?? "" }));
}

const aboutBody = z.object({ body: z.string().optional() });

async function findEvent(ctx: Context, slug: string): Promise<EventRow | Response> {
  if (!SLUG.test(slug)) return failure(404, "There is no event with that address.");
  const { data, error } = await ctx.supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("org_id", ctx.org.id)
    .eq("slug", slug)
    .maybeSingle();
  if (error) return failure(500, "Couldn't load the event.");
  if (!data) return failure(404, "There is no event with that address.");
  const [event] = (await withAbout(ctx, [data])) ?? [];
  return event ?? failure(500, "Couldn't load the event.");
}

async function withEvent(
  request: Request,
  slug: string,
  then: (ctx: Context, event: EventRow) => Promise<Response>,
): Promise<Response> {
  const ctx = await context(request);
  if (ctx instanceof Response) return ctx;
  const event = await findEvent(ctx, slug);
  if (event instanceof Response) return event;
  return then(ctx, event);
}

export async function listEvents(request: Request): Promise<Response> {
  const ctx = await context(request);
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("org_id", ctx.org.id)
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) return failure(500, "Couldn't load events.");
  const events = await withAbout(ctx, data);
  if (!events) return failure(500, "Couldn't load events.");
  return json({
    organization: { slug: ctx.org.slug, name: ctx.org.name },
    events: events.map((row) => eventJson(ctx.origin, row)),
  });
}

export function getEvent(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const [windows, prizes] = await Promise.all([
      ctx.supabase
        .from("event_windows")
        .select("key, opens_at, closes_at, override")
        .eq("event_id", event.id),
      ctx.supabase
        .from("tracks")
        .select("name, description_md, prize_md, sponsor_name, sponsor_logo_url, max_winners")
        .eq("event_id", event.id)
        .order("sort"),
    ]);
    if (windows.error || prizes.error) return failure(500, "Couldn't load the event.");
    return json({
      ...eventJson(ctx.origin, event),
      windows: windows.data.map((window) => ({
        key: window.key,
        opensAt: window.opens_at,
        closesAt: window.closes_at,
        override: window.override,
      })),
      prizes: prizes.data.map((prize) => ({
        name: prize.name,
        description: prize.description_md,
        prize: prize.prize_md,
        sponsor: prize.sponsor_name,
        sponsorLogo: prize.sponsor_logo_url,
        maxWinners: prize.max_winners,
      })),
    });
  });
}

const agendaSchema = z.object({
  slots: z.array(
    z.object({
      name: z.string().nullable(),
      starts_at: z.string(),
      ends_at: z.string().nullable(),
      sessions: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          name: z.string(),
          description_md: z.string(),
          location: z.string().nullable(),
          starts_at: z.string().nullable(),
          ends_at: z.string().nullable(),
          host_note: z.string().nullable(),
          capacity: z.number().nullable(),
          category: z.string().nullable(),
          hosts: z.array(z.object({ name: z.string() })),
        }),
      ),
    }),
  ),
});

async function loadAgenda(ctx: Context, eventId: string) {
  const { data, error } = await ctx.supabase.rpc("event_agenda", { p_event: eventId });
  if (error) return null;
  const parsed = agendaSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function getAgenda(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const agenda = await loadAgenda(ctx, event.id);
    if (!agenda) return failure(500, "Couldn't load the agenda.");
    return json({
      event: event.slug,
      timezone: event.timezone,
      slots: agenda.slots.map((slot) => ({
        name: slot.name,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        sessions: slot.sessions.map((session) => ({
          id: session.id,
          kind: session.kind,
          name: session.name,
          description: session.description_md,
          location: session.location,
          startsAt: session.starts_at ?? slot.starts_at,
          endsAt: session.ends_at ?? slot.ends_at,
          category: session.category,
          hosts: session.hosts.map((host) => host.name),
          hostNote: session.host_note,
          capacity: session.capacity,
        })),
      })),
    });
  });
}

export function getAgendaIcs(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const agenda = await loadAgenda(ctx, event.id);
    if (!agenda) return failure(500, "Couldn't load the agenda.");
    const entries: CalendarEntry[] = agenda.slots.flatMap((slot) =>
      slot.sessions.map((session) => {
        const ends = session.ends_at ?? slot.ends_at;
        return {
          uid: `session-${session.id}@${requestHost()}`,
          title: session.name,
          startsAt: new Date(session.starts_at ?? slot.starts_at),
          endsAt: ends ? new Date(ends) : null,
          description: session.description_md || null,
          location: session.location,
          url: `${ctx.origin}/events/${event.slug}/agenda`,
        };
      }),
    );
    return reply(toIcal({ name: `${event.name} agenda`, entries }), "text/calendar; charset=utf-8");
  });
}

const READABLE = new Set(["text", "longtext", "markdown", "url", "video"]);

export function getGallery(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const [projects, items, tracks] = await Promise.all([
      ctx.supabase
        .from("submissions")
        .select(
          "id, title, form_id, answers, submitted_at, teams(name), submission_tracks(track_id)",
        )
        .eq("event_id", event.id)
        .eq("status", "submitted")
        .eq("is_public", true)
        .order("submitted_at", { ascending: false })
        .limit(500),
      ctx.supabase
        .from("submission_items")
        .select("form_id, key, label, kind")
        .eq("event_id", event.id),
      ctx.supabase.from("tracks").select("id, name").eq("event_id", event.id),
    ]);
    if (projects.error || items.error || tracks.error)
      return failure(500, "Couldn't load the gallery.");
    const trackNames = new Map(tracks.data.map((track) => [track.id, track.name]));
    return json({
      event: event.slug,
      projects: projects.data.map((project) => {
        const answers =
          typeof project.answers === "object" &&
          project.answers !== null &&
          !Array.isArray(project.answers)
            ? project.answers
            : {};
        return {
          id: project.id,
          title: project.title,
          team: project.teams?.name ?? null,
          submittedAt: project.submitted_at,
          prizes: project.submission_tracks.flatMap((entry) => {
            const name = trackNames.get(entry.track_id);
            return name ? [name] : [];
          }),
          answers: items.data
            .filter((item) => item.form_id === project.form_id && READABLE.has(item.kind))
            .flatMap((item) => {
              const value = answers[item.key];
              return typeof value === "string" && value !== ""
                ? [{ label: item.label, kind: item.kind, value }]
                : [];
            }),
        };
      }),
    });
  });
}

export function getResults(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const { data, error } = await ctx.supabase
      .from("result_publications")
      .select("rows, awards, published_at")
      .eq("event_id", event.id)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return failure(500, "Couldn't load the results.");
    if (!data) return json({ event: event.slug, published: false });
    const asJson = (value: Json) => value;
    return json({
      event: event.slug,
      published: true,
      publishedAt: data.published_at,
      awards: asJson(data.awards),
      rankings: asJson(data.rows),
    });
  });
}

async function announcementFeed(
  ctx: Context,
  event: EventRow,
  selfPath: string,
): Promise<Feed | null> {
  const { data, error } = await ctx.supabase.rpc("public_announcements", { p_event: event.id });
  if (error) return null;
  const page = `${ctx.origin}/events/${event.slug}`;
  return {
    id: `tag:${requestHost()},2026:events/${event.slug}/announcements`,
    title: `${event.name} announcements`,
    url: page,
    selfUrl: `${ctx.origin}${selfPath}`,
    entries: data.map((announcement) => ({
      id: `tag:${requestHost()},2026:announcement/${announcement.id}`,
      title: announcement.title,
      updated: new Date(announcement.published_at),
      content: announcement.body_md,
      url: page,
    })),
  };
}

export function getAnnouncements(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const { data, error } = await ctx.supabase.rpc("public_announcements", { p_event: event.id });
    if (error) return failure(500, "Couldn't load announcements.");
    return json({
      event: event.slug,
      announcements: data.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        body: announcement.body_md,
        severity: announcement.severity,
        publishedAt: announcement.published_at,
      })),
    });
  });
}

export function getAnnouncementsFeed(
  request: Request,
  slug: string,
  format: "atom" | "rss",
): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) => {
    const feed = await announcementFeed(
      ctx,
      event,
      `/api/v1/events/${event.slug}/announcements.${format}`,
    );
    if (!feed) return failure(500, "Couldn't load announcements.");
    return format === "atom"
      ? reply(toAtom(feed), "application/atom+xml; charset=utf-8")
      : reply(toRss(feed), "application/rss+xml; charset=utf-8");
  });
}

export function getHackathonJson(request: Request, slug: string): Promise<Response> {
  return withEvent(request, slug, async (ctx, event) =>
    json(
      hackathonJson({
        name: event.name,
        description: event.about,
        url: `${ctx.origin}/events/${event.slug}`,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        timezone: event.timezone,
      }),
    ),
  );
}

const personalSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      event_name: z.string(),
      name: z.string(),
      location: z.string().nullable(),
      description: z.string(),
      starts_at: z.string(),
      ends_at: z.string().nullable(),
    }),
  ),
  windows: z.array(
    z.object({
      event: z.string(),
      event_name: z.string(),
      key: z.string(),
      opens_at: z.string().nullable(),
      closes_at: z.string().nullable(),
    }),
  ),
});

function windowLabel(key: string): string {
  const name = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, " ");
}

export async function getPersonalCalendar(request: Request, rawToken: string): Promise<Response> {
  const ctx = await context(request);
  if (ctx instanceof Response) return ctx;
  const token = rawToken.replace(/\.ics$/, "");
  if (!/^bgc_[0-9a-f]{48}$/.test(token)) return failure(404, "This calendar link isn't valid.");
  const { data, error } = await ctx.supabase.rpc("calendar_feed", { p_token: token });
  if (error) return failure(500, "Couldn't load the calendar.");
  const parsed = personalSchema.safeParse(data);
  if (!parsed.success) return failure(404, "This calendar link isn't valid.");
  const host = requestHost();
  const entries: CalendarEntry[] = [
    ...parsed.data.sessions.map((session) => ({
      uid: `session-${session.id}@${host}`,
      title: session.name,
      startsAt: new Date(session.starts_at),
      endsAt: session.ends_at ? new Date(session.ends_at) : null,
      description: session.description || null,
      location: session.location,
      url: `${ctx.origin}/events/${session.event}/agenda`,
    })),
    ...parsed.data.windows.flatMap((window) =>
      [
        ["opens", window.opens_at],
        ["closes", window.closes_at],
      ].flatMap(([verb, at]) =>
        at
          ? [
              {
                uid: `window-${window.event}-${window.key}-${verb}@${host}`,
                title: `${windowLabel(window.key)} ${verb} (${window.event_name})`,
                startsAt: new Date(at),
                endsAt: new Date(new Date(at).getTime() + 15 * 60 * 1000),
                description: null,
                location: null,
                url: `${ctx.origin}/events/${window.event}`,
              },
            ]
          : [],
      ),
    ),
  ];
  return reply(
    toIcal({ name: `${ctx.org.name} schedule`, entries }),
    "text/calendar; charset=utf-8",
    "private, no-store",
  );
}
