import { SESSION_KIND_TONES } from "@bogey/config/settings";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { optionalId, optionalText, requireId, requireOneOf, requireText } from "./validate.ts";

export type Tag = Tables<"tags">;

export interface TagScope {
  orgId: string;
  /** With an event: the org's tags and the event's own. Without: the org's only. */
  eventId?: string;
}

export interface TagHolder {
  tagId: string;
  userId: string;
}

const PERMISSION = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

function requireScope(input: unknown): TagScope {
  const raw = (input ?? {}) as { orgId?: unknown; eventId?: unknown };
  const eventId = optionalId(raw.eventId, "eventId");
  return { orgId: requireId(raw.orgId, "orgId"), ...(eventId ? { eventId } : {}) };
}

export const tagsFn = createServerFn({ method: "GET" })
  .validator(requireScope)
  .handler(async ({ data }): Promise<DbResult<Tag[]>> => {
    const query = createServerClient().from("tags").select("*").eq("org_id", data.orgId);
    const { data: rows, error } = await (
      data.eventId
        ? query.or(`event_id.is.null,event_id.eq.${data.eventId}`)
        : query.is("event_id", null)
    )
      .order("sort")
      .order("name");
    if (error) return toFailure(error, "loading tags");
    return ok(rows);
  });

export const tagsQueryOptions = (scope: TagScope) =>
  queryOptions({
    queryKey: ["tags", scope.orgId, scope.eventId ?? null] as const,
    queryFn: async () => unwrap(await tagsFn({ data: scope })),
    retry: retryPolicy,
  });

export const tagHoldersFn = createServerFn({ method: "GET" })
  .validator(requireScope)
  .handler(async ({ data }): Promise<DbResult<TagHolder[]>> => {
    const query = createServerClient()
      .from("tag_holders")
      .select("tag_id, user_id")
      .eq("org_id", data.orgId);
    const { data: rows, error } = await (data.eventId
      ? query.or(`event_id.is.null,event_id.eq.${data.eventId}`)
      : query.is("event_id", null));
    if (error) return toFailure(error, "loading who holds which tags");
    return ok(rows.map((row) => ({ tagId: row.tag_id, userId: row.user_id })));
  });

export const tagHoldersQueryOptions = (scope: TagScope) =>
  queryOptions({
    queryKey: ["tag-holders", scope.orgId, scope.eventId ?? null] as const,
    queryFn: async () => unwrap(await tagHoldersFn({ data: scope })),
    retry: retryPolicy,
  });

export interface TagInput {
  id: string;
  name: string;
  description: string;
  tone: (typeof SESSION_KIND_TONES)[number];
  permissions: string[];
}

function requireTag(item: unknown): TagInput {
  const raw = (item ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.permissions) || raw.permissions.length > 20) {
    throw new Error("Permissions must be a list");
  }
  const permissions = raw.permissions.map((permission) => {
    if (typeof permission !== "string" || !PERMISSION.test(permission)) {
      throw new Error("Unknown permission");
    }
    return permission;
  });
  return {
    id: optionalId(raw.id === "" ? undefined : raw.id, "id") ?? "",
    name: requireText(raw.name, "Tag name", 40),
    description: optionalText(raw.description, "Description", 200) ?? "",
    tone: requireOneOf(raw.tone, SESSION_KIND_TONES, "tone"),
    permissions: [...new Set(permissions)],
  };
}

// saves the scope's own tags as a list: the event's with eventId, the org's without
export const saveTagsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { tags?: unknown };
    if (!Array.isArray(raw.tags) || raw.tags.length > 50) {
      throw new Error("tags must be a list of up to 50");
    }
    return { ...requireScope(input), tags: raw.tags.map(requireTag) };
  })
  .handler(async ({ data }): Promise<DbResult<Tag[]>> => {
    const supabase = createServerClient();
    const own = supabase.from("tags").select("id").eq("org_id", data.orgId);
    const { data: existing, error: loadError } = await (data.eventId
      ? own.eq("event_id", data.eventId)
      : own.is("event_id", null));
    if (loadError) return toFailure(loadError, "loading tags");

    const kept = new Set(data.tags.flatMap((tag) => tag.id || []));
    const removed = existing.map((row) => row.id).filter((id) => !kept.has(id));
    if (removed.length) {
      const { error } = await supabase.from("tags").delete().in("id", removed);
      if (error) return toFailure(error, "removing tags");
    }
    for (const [sort, tag] of data.tags.entries()) {
      const fields = {
        name: tag.name,
        description: tag.description,
        tone: tag.tone,
        permissions: tag.permissions,
        sort,
      };
      const { error } = tag.id
        ? await supabase.from("tags").update(fields).eq("id", tag.id)
        : await supabase
            .from("tags")
            .insert({ ...fields, org_id: data.orgId, event_id: data.eventId ?? null });
      if (error) return toFailure(error, `saving "${tag.name}"`);
    }

    const saved = supabase.from("tags").select("*").eq("org_id", data.orgId);
    const { data: rows, error } = await (
      data.eventId ? saved.eq("event_id", data.eventId) : saved.is("event_id", null)
    ).order("sort");
    if (error) return toFailure(error, "loading tags");
    return ok(rows);
  });

// replaces the person's tags in one scope: the event's own with eventId, the org's without
export const setPersonTagsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { userId?: unknown; tagIds?: unknown };
    if (!Array.isArray(raw.tagIds) || raw.tagIds.length > 50)
      throw new Error("Tags must be a list");
    return {
      ...requireScope(input),
      userId: requireId(raw.userId, "userId"),
      tagIds: [...new Set(raw.tagIds.map((id) => requireId(id, "tagId")))],
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("set_person_tags", {
      p_user: data.userId,
      p_tags: data.tagIds,
      p_org: data.orgId,
      ...(data.eventId ? { p_event: data.eventId } : {}),
    });
    if (error) return toFailure(error, "changing those tags");
    return ok(null);
  });
