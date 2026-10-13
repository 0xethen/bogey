import { infiniteQueryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { jsonRecord, type JsonRecord } from "../types.ts";
import { requireId } from "./validate.ts";

export interface AuditEntry {
  id: number;
  action: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  meta: JsonRecord;
  event: { name: string; slug: string } | null;
}

export interface AuditFilter {
  group?: string;
  actor?: string;
  event?: string;
  from?: string;
  to?: string;
}

const PAGE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFilter(raw: Record<string, unknown>): AuditFilter {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  const group = text(raw.group);
  const from = text(raw.from);
  const to = text(raw.to);
  return {
    group: group && /^[a-z][a-z0-9-]*$/.test(group) ? group : undefined,
    actor: text(raw.actor) && ID.test(text(raw.actor) ?? "") ? text(raw.actor) : undefined,
    event: text(raw.event) && ID.test(text(raw.event) ?? "") ? text(raw.event) : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
  };
}

export const auditLogFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const before = Number(raw.before);
    return {
      orgId: requireId(raw.orgId, "orgId"),
      filter: readFilter((raw.filter ?? {}) as Record<string, unknown>),
      before: Number.isInteger(before) && before > 0 ? before : undefined,
    };
  })
  .handler(async ({ data }): Promise<DbResult<{ entries: AuditEntry[]; more: boolean }>> => {
    const supabase = createServerClient();
    const { filter } = data;

    let query = supabase
      .from("audit_log")
      .select(
        "id, action, created_at, actor_id, target_type, target_id, meta, actor:profiles(display_name), event:events(name, slug)",
      )
      .order("id", { ascending: false })
      .limit(PAGE + 1);
    query = query.eq("org_id", data.orgId);
    if (filter.event) query = query.eq("event_id", filter.event);
    if (data.before) query = query.lt("id", data.before);
    if (filter.group) {
      query = query.or(`action.like.${filter.group}.*,action.like.${filter.group}s.*`);
    }
    if (filter.actor) query = query.eq("actor_id", filter.actor);
    if (filter.from) query = query.gte("created_at", `${filter.from}T00:00:00Z`);
    if (filter.to) query = query.lte("created_at", `${filter.to}T23:59:59.999Z`);

    const { data: rows, error } = await query;
    if (error) return toFailure(error, "loading the audit log");

    const people = [
      ...new Set(
        rows.flatMap((row) => (row.target_type === "user" && row.target_id ? [row.target_id] : [])),
      ),
    ];
    const targets = new Map<string, string>();
    if (people.length) {
      const { data: found, error: peopleError } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", people);
      if (peopleError) return toFailure(peopleError, "loading the audit log");
      for (const person of found) targets.set(person.id, person.display_name);
    }

    return ok({
      more: rows.length > PAGE,
      entries: rows.slice(0, PAGE).map((row) => ({
        id: row.id,
        action: row.action,
        at: row.created_at,
        actorId: row.actor_id,
        actorName: row.actor?.display_name ?? null,
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_id ? (targets.get(row.target_id) ?? null) : null,
        meta: jsonRecord(row.meta),
        event: row.event ?? null,
      })),
    });
  });

export const auditLogQueryOptions = (orgId: string, filter: AuditFilter) =>
  infiniteQueryOptions({
    queryKey: ["audit", orgId, filter] as const,
    queryFn: async ({ pageParam }) =>
      unwrap(await auditLogFn({ data: { orgId, filter: { ...filter }, before: pageParam } })),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.more ? page.entries.at(-1)?.id : undefined),
    retry: retryPolicy,
  });
