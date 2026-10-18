import { isLocale } from "@bogey/utils/locale";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { COLUMN_VALUES, type Tables } from "../types.ts";
import { linksFromJson, profileLinksProblem, type ProfileLink } from "@bogey/utils/profile-links";
import { optionalText, requireOneOf, requireText } from "./validate.ts";

export type Profile = Tables<"profiles">;

export interface ProfileChanges {
  displayName?: string;
  timezone?: string | null;
  locale?: string | null;
  handle?: string | null;
  bio?: string;
  pronouns?: string | null;
  links?: ProfileLink[];
  visibility?: "org" | "public";
}

const HANDLE = /^[a-z0-9_]{2,32}$/;

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const updateProfileFn = createServerFn({ method: "POST" })
  .validator((input: unknown): ProfileChanges => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const out: ProfileChanges = {};
    if (raw.locale !== undefined) {
      if (raw.locale === null || raw.locale === "") out.locale = null;
      else if (typeof raw.locale === "string" && isLocale(raw.locale)) out.locale = raw.locale;
      else throw new Error("Choose a language from the list");
    }
    if (raw.handle !== undefined) {
      if (raw.handle === null || raw.handle === "") out.handle = null;
      else if (typeof raw.handle === "string" && HANDLE.test(raw.handle)) out.handle = raw.handle;
      else throw new Error("A handle is 2 to 32 lowercase letters, numbers or underscores");
    }
    if (raw.bio !== undefined) out.bio = requireText(raw.bio, "About you", 1000).trim();
    if (raw.pronouns !== undefined) out.pronouns = optionalText(raw.pronouns, "Pronouns", 30);
    if (raw.links !== undefined) {
      const links = linksFromJson(raw.links);
      if (!Array.isArray(raw.links) || links.length !== raw.links.length)
        throw new Error("Each link needs a platform and an address");
      const problem = profileLinksProblem(links);
      if (problem) throw new Error(problem);
      out.links = links.map((link) => ({ kind: link.kind, url: link.url.trim() }));
    }
    if (raw.visibility !== undefined) {
      out.visibility = requireOneOf(
        raw.visibility,
        COLUMN_VALUES.profiles.visibility,
        "visibility",
      );
    }
    if (raw.displayName !== undefined) out.displayName = requireText(raw.displayName, "Name", 80);
    if (raw.timezone !== undefined) {
      if (
        raw.timezone !== null &&
        (typeof raw.timezone !== "string" || !validTimezone(raw.timezone))
      ) {
        throw new Error("Choose a timezone from the list");
      }
      out.timezone = raw.timezone;
    }
    return out;
  })
  .handler(async ({ data }): Promise<DbResult<Profile>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");

    const { data: profile, error } = await supabase
      .from("profiles")
      .update({
        ...(data.displayName !== undefined ? { display_name: data.displayName } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.locale !== undefined ? { locale: data.locale } : {}),
        ...(data.handle !== undefined ? { handle: data.handle } : {}),
        ...(data.bio !== undefined ? { bio_md: data.bio } : {}),
        ...(data.pronouns !== undefined ? { pronouns: data.pronouns } : {}),
        ...(data.links !== undefined
          ? { links: data.links.map((link) => ({ kind: link.kind, url: link.url })) }
          : {}),
        ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      })
      .eq("id", userData.user.id)
      .select("*")
      .single();

    if (error) return toFailure(error, "saving your profile");
    return ok(profile);
  });

export interface AccountDeletion {
  enabled: boolean;
  requestedAt: string | null;
}

export const accountDeletionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<AccountDeletion>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("account_deletion_status");
    if (error) return toFailure(error, "loading your account");
    const status = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    return ok({
      enabled: status.enabled !== false,
      requestedAt: typeof status.requestedAt === "string" ? status.requestedAt : null,
    });
  },
);

export const accountDeletionQueryOptions = () =>
  queryOptions({
    queryKey: ["account", "deletion"] as const,
    queryFn: async () => unwrap(await accountDeletionFn()),
    retry: retryPolicy,
  });

export const requestAccountDeletionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { reason?: unknown };
    return { reason: optionalText(raw.reason, "reason", 1000) ?? "" };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");
    const { error } = await supabase
      .from("account_deletion_requests")
      .upsert({ user_id: userData.user.id, reason: data.reason }, { onConflict: "user_id" });
    if (error) return toFailure(error, "requesting deletion");
    return ok(null);
  });

export const cancelAccountDeletionFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");
    const { error } = await supabase
      .from("account_deletion_requests")
      .delete()
      .eq("user_id", userData.user.id);
    if (error) return toFailure(error, "cancelling the request");
    return ok(null);
  },
);

export const portfoliosEnabledFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<boolean>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("portfolios_enabled");
    if (error) return toFailure(error, "loading your account");
    return ok(data === true);
  },
);

export const portfoliosEnabledQueryOptions = () =>
  queryOptions({
    queryKey: ["account", "portfolios"] as const,
    queryFn: async () => unwrap(await portfoliosEnabledFn()),
    retry: retryPolicy,
  });

export interface Portfolio {
  name: string;
  handle: string;
  avatarPath: string | null;
  pronouns: string | null;
  bio: string;
  links: ProfileLink[];
  visibility: "org" | "public";
  projects: Array<{
    id: string;
    title: string;
    team: string;
    event: string;
    eventName: string;
    submittedAt: string | null;
  }>;
  awards: Array<{
    kind: string;
    label: string;
    place: number | null;
    project: string;
    event: string;
    eventName: string;
  }>;
  events: Array<{ slug: string; name: string; startsAt: string | null }>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);
const records = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry),
      )
    : [];

export const portfolioFn = createServerFn({ method: "GET" })
  .validator((handle: unknown) => {
    if (typeof handle !== "string" || !HANDLE.test(handle.toLowerCase()))
      throw new Error("That isn't a handle");
    return handle.toLowerCase();
  })
  .handler(async ({ data: handle }): Promise<DbResult<Portfolio | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("public_profile", { p_handle: handle });
    if (error) return toFailure(error, "loading the profile");
    if (typeof data !== "object" || data === null || Array.isArray(data)) return ok(null);
    return ok({
      name: text(data.name),
      handle: text(data.handle),
      avatarPath: textOrNull(data.avatarPath),
      pronouns: textOrNull(data.pronouns),
      bio: text(data.bio),
      links: linksFromJson(data.links),
      visibility: data.visibility === "public" ? "public" : "org",
      projects: records(data.projects).map((row) => ({
        id: text(row.id),
        title: text(row.title),
        team: text(row.team),
        event: text(row.event),
        eventName: text(row.eventName),
        submittedAt: textOrNull(row.submittedAt),
      })),
      awards: records(data.awards).map((row) => ({
        kind: text(row.kind),
        label: text(row.label),
        place: typeof row.place === "number" ? row.place : null,
        project: text(row.project),
        event: text(row.event),
        eventName: text(row.eventName),
      })),
      events: records(data.events).map((row) => ({
        slug: text(row.slug),
        name: text(row.name),
        startsAt: textOrNull(row.startsAt),
      })),
    });
  });

export const portfolioQueryOptions = (handle: string) =>
  queryOptions({
    queryKey: ["portfolio", handle.toLowerCase()] as const,
    queryFn: async () => unwrap(await portfolioFn({ data: handle })),
    retry: retryPolicy,
  });
