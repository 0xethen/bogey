import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import {
  fail,
  ok,
  requestFailure,
  retryPolicy,
  toFailure,
  unwrap,
  type DbResult,
} from "../errors.ts";
import { jsonRecord, type Json, type JsonRecord } from "../types.ts";
import {
  isCoreNamespace,
  isSettingKey,
  parseSettings,
  scopesBelow,
  resolveSettings,
  storedSettings,
  type CoreNamespace,
  type ResolvedValue,
  type SettingScope,
  type SettingsChanges,
  type SettingsValue,
} from "@bogey/config/settings";
import { optionalId, requireId } from "./validate.ts";
import { ownScope, readOwnSettings } from "./settings-row.ts";

export type ResolvedSettings<N extends CoreNamespace> = { [K in N]: ResolvedValue<K> };

function namespaceList(value: unknown): CoreNamespace[] {
  const namespaces = Array.isArray(value) ? value : [];
  if (
    !namespaces.every((ns): ns is CoreNamespace => typeof ns === "string" && isCoreNamespace(ns))
  ) {
    throw new Error("namespaces must be core setting namespaces");
  }
  return namespaces;
}

export const settingsForFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; eventId?: unknown; namespaces?: unknown };
    return {
      orgId: optionalId(raw.orgId, "orgId") ?? null,
      eventId: optionalId(raw.eventId, "eventId") ?? null,
      namespaces: namespaceList(raw.namespaces),
    };
  })
  .handler(async ({ data }): Promise<DbResult<JsonRecord>> => {
    const supabase = createServerClient();
    const { data: resolved, error } = await supabase.rpc("settings_for", {
      p_namespaces: data.namespaces,
      ...(data.orgId ? { p_org: data.orgId } : {}),
      ...(data.eventId ? { p_event: data.eventId } : {}),
    });
    if (error) return toFailure(error, "loading settings");
    return ok(jsonRecord(resolved));
  });

export const settingsQueryOptions = <const N extends CoreNamespace>(
  scope: { orgId?: string; eventId?: string },
  namespaces: Tuple<N>,
) =>
  queryOptions({
    queryKey: [
      "settings",
      scope.orgId ?? null,
      scope.eventId ?? null,
      [...namespaces].sort(),
    ] as const,
    queryFn: async (): Promise<ResolvedSettings<N>> => {
      const raw = unwrap(await settingsForFn({ data: { ...scope, namespaces: [...namespaces] } }));
      const out: Partial<Record<CoreNamespace, unknown>> = {};
      for (const namespace of namespaces)
        out[namespace] = resolveSettings(namespace, raw[namespace]);
      return out as ResolvedSettings<N>;
    },
    retry: retryPolicy,
    staleTime: 60_000,
  });

export interface OwnScope {
  scope: SettingScope;
  orgId?: string;
  eventId?: string;
}

export const ownSettingsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { namespace?: unknown };
    const [namespace] = namespaceList([raw.namespace]);
    if (!namespace) throw new Error("Unknown settings namespace");
    return { ...ownScope(input ?? {}), namespace };
  })
  .handler(async ({ data }): Promise<DbResult<JsonRecord>> => {
    const { data: row, error } = await readOwnSettings(data, data.namespace);
    if (error) return toFailure(error, "loading settings");
    return ok(jsonRecord(row?.value));
  });

export const ownSettingsQueryOptions = <N extends CoreNamespace>(scope: OwnScope, namespace: N) =>
  queryOptions({
    queryKey: [
      "settings",
      "own",
      scope.scope,
      scope.orgId ?? null,
      scope.eventId ?? null,
      namespace,
    ] as const,
    queryFn: async (): Promise<Partial<SettingsValue<N>>> =>
      storedSettings(namespace, unwrap(await ownSettingsFn({ data: { ...scope, namespace } }))),
    retry: retryPolicy,
  });

export const ownLocksFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { namespace?: unknown };
    const [namespace] = namespaceList([raw.namespace]);
    if (!namespace) throw new Error("Unknown settings namespace");
    return { ...ownScope(input ?? {}), namespace };
  })
  .handler(async ({ data }): Promise<DbResult<string[]>> => {
    const { data: row, error } = await readOwnSettings(data, data.namespace);
    if (error) return toFailure(error, "loading setting locks");
    return ok(row?.locked_keys ?? []);
  });

export const ownLocksQueryOptions = (scope: OwnScope, namespace: CoreNamespace) =>
  queryOptions({
    queryKey: [
      "settings",
      "locks",
      scope.scope,
      scope.orgId ?? null,
      scope.eventId ?? null,
      namespace,
    ] as const,
    queryFn: async () => unwrap(await ownLocksFn({ data: { ...scope, namespace } })),
    retry: retryPolicy,
  });

export const setSettingLockFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { namespace?: unknown; key?: unknown; locked?: unknown };
    const [namespace] = namespaceList([raw.namespace]);
    if (!namespace) throw new Error("Unknown settings namespace");
    const scope = ownScope(input ?? {});
    if (typeof raw.key !== "string" || !isSettingKey(namespace, raw.key)) {
      throw new Error("Unknown setting");
    }
    if (typeof raw.locked !== "boolean") throw new Error("locked must be true or false");
    if (scopesBelow(namespace, scope.scope).length === 0) {
      throw new Error("Nothing below this level can change that setting");
    }
    return { ...scope, namespace, key: raw.key, locked: raw.locked };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: row, error: readError } = await readOwnSettings(data, data.namespace);
    if (readError) return toFailure(readError, "saving the lock");
    const others = (row?.locked_keys ?? []).filter((key) => key !== data.key);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("settings").upsert(
      {
        scope: data.scope,
        org_id: data.orgId,
        event_id: data.eventId,
        namespace: data.namespace,
        value: row?.value ?? {},
        locked_keys: data.locked ? [...others, data.key] : others,
        updated_by: userData.user?.id ?? null,
      },
      { onConflict: "scope,org_id,event_id,namespace" },
    );
    if (error) return toFailure(error, "saving the lock");
    return ok(null);
  });

export const updateSettingsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { namespace?: unknown; changes?: unknown };
    const [namespace] = namespaceList([raw.namespace]);
    if (!namespace) throw new Error("Unknown settings namespace");
    const changes = raw.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new Error("changes must be an object");
    }
    return { ...ownScope(input ?? {}), namespace, changes: { ...changes } };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: row, error: readError } = await readOwnSettings(data, data.namespace);
    if (readError) return toFailure(readError, "saving settings");

    const merged: Record<string, unknown> = { ...jsonRecord(row?.value), ...data.changes };
    for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
    let value: SettingsValue<CoreNamespace>;
    try {
      value = parseSettings(data.namespace, data.scope, merged);
    } catch (error) {
      return fail("invalid", error instanceof Error ? error.message : "Invalid settings");
    }

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("settings").upsert(
      {
        scope: data.scope,
        org_id: data.orgId,
        event_id: data.eventId,
        namespace: data.namespace,
        value,
        updated_by: userData.user?.id ?? null,
      },
      { onConflict: "scope,org_id,event_id,namespace" },
    );
    if (error) return toFailure(error, "saving settings");
    return ok(null);
  });

export function updateSettings<N extends CoreNamespace>(
  scope: OwnScope,
  namespace: N,
  changes: SettingsChanges<N>,
): Promise<DbResult<null>> {
  return updateSettingsFn({ data: { ...scope, namespace, changes } }).catch(requestFailure);
}

export interface InheritedSettings<N extends CoreNamespace> {
  defaults: ResolvedValue<N>;
  instance: Partial<SettingsValue<N>>;
  org: Partial<SettingsValue<N>>;
  instanceLocked: string[];
  orgLocked: string[];
}

export const inheritedSettingsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { namespace?: unknown };
    const [namespace] = namespaceList([raw.namespace]);
    if (!namespace) throw new Error("Unknown settings namespace");
    return { ...ownScope(input ?? {}), namespace };
  })
  .handler(async ({ data }): Promise<DbResult<JsonRecord>> => {
    const supabase = createServerClient();
    const { data: inherited, error } = await supabase.rpc("inherited_settings", {
      p_scope: data.scope,
      ...(data.orgId ? { p_org: data.orgId } : {}),
      ...(data.eventId ? { p_event: data.eventId } : {}),
      p_namespace: data.namespace,
    });
    if (error) return toFailure(error, "loading settings");
    return ok(jsonRecord(inherited));
  });

function keys(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
}

export const inheritedSettingsQueryOptions = <N extends CoreNamespace>(
  scope: OwnScope,
  namespace: N,
) =>
  queryOptions({
    queryKey: [
      "settings",
      "inherited",
      scope.scope,
      scope.orgId ?? null,
      scope.eventId ?? null,
      namespace,
    ] as const,
    queryFn: async (): Promise<InheritedSettings<N>> => {
      const raw = unwrap(await inheritedSettingsFn({ data: { ...scope, namespace } }));
      return {
        defaults: resolveSettings(namespace, raw.defaults),
        instance: storedSettings(namespace, raw.instance),
        org: storedSettings(namespace, raw.org),
        instanceLocked: keys(raw.instanceLocked),
        orgLocked: keys(raw.orgLocked),
      };
    },
    retry: retryPolicy,
  });

export interface NetworkStatus {
  restricted: boolean;
  allowed: boolean;
  areas: string[];
  ip: string | null;
}

export const networkStatusFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<NetworkStatus>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("event_network_status", { p_event: eventId });
    if (error) return toFailure(error, "checking your network");
    const status = jsonRecord(data);
    return ok({
      restricted: status.restricted === true,
      allowed: status.allowed !== false,
      areas: Array.isArray(status.areas)
        ? status.areas.filter((area): area is string => typeof area === "string")
        : [],
      ip: typeof status.ip === "string" ? status.ip : null,
    });
  });

export const networkStatusQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["settings", "network-status", eventId] as const,
    queryFn: async () => unwrap(await networkStatusFn({ data: eventId })),
    retry: retryPolicy,
    staleTime: 15_000,
  });

export interface BlockedAccess {
  at: string;
  name: string | null;
  ip: string | null;
  /** Where it was refused: a core area or `plugin.area`; null when unknown. */
  area: string | null;
}

export const blockedAccessFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<BlockedAccess[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("event_blocked_access", { p_event: eventId });
    if (error) return toFailure(error, "loading blocked attempts");
    return ok(data.map((row) => ({ at: row.at, name: row.name, ip: row.ip, area: row.area })));
  });

export const blockedAccessQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["settings", "blocked-access", eventId] as const,
    queryFn: async () => unwrap(await blockedAccessFn({ data: eventId })),
    retry: retryPolicy,
  });
