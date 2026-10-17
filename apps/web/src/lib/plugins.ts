import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServerClient } from "@bogey/db/server";
import {
  fail,
  ok,
  requestFailure,
  retryPolicy,
  toFailure,
  unwrap,
  type DbResult,
} from "@bogey/db/errors";
import { jsonRecord, type JsonRecord } from "@bogey/db/types";
import type { OwnScope } from "@bogey/db/queries/settings";
import { ownScope, readOwnSettings } from "@bogey/db/queries/settings-row";
import type { ResolvedValue, SessionKind } from "@bogey/config/settings";
import { can } from "@bogey/db/permissions";
import {
  findPlugin,
  installedPlugins,
  pluginLimitsNamespace,
  pluginPageUrl,
  pluginRoutes,
  isRouteListed,
  routeArea,
  pluginSessionKinds,
  pluginStatuses,
  pluginNamespace,
  settingsEditableAt,
  validPluginSettings,
  type PluginManifest,
  type PluginRouteArea,
} from "@bogey/plugins";
import type { EventTab } from "#/components/navigation/header/TabRow.tsx";
import type { EventViewer } from "#/lib/viewer.ts";

export function offeredPlugins(settings: ResolvedValue<"plugins">): PluginManifest[] {
  return installedPlugins().filter(
    (manifest) => !settings.available || settings.available.includes(manifest.key),
  );
}

export function enabledPlugins(settings: ResolvedValue<"plugins">): PluginManifest[] {
  return offeredPlugins(settings).filter((manifest) => settings.enabled.includes(manifest.key));
}

export function sessionKindsWithPlugins(
  kinds: Tuple<SessionKind>,
  plugins: Tuple<PluginManifest>,
): SessionKind[] {
  const added = pluginSessionKinds(plugins)
    .filter((kind) => !kinds.some((own) => own.key === kind.id))
    .map((kind): SessionKind => ({
      key: kind.id,
      label: kind.label,
      tone: kind.tone,
      icon: kind.icon,
    }));
  return [...kinds, ...added];
}

export interface MissingPlugin {
  key: string;
  reason: string;
}

export function missingPlugins(settings: ResolvedValue<"plugins">): MissingPlugin[] {
  const statuses = pluginStatuses();
  return settings.enabled.flatMap((key): MissingPlugin[] => {
    const found = statuses.find((each) => each.manifest.key === key);
    if (!found) return [{ key, reason: "isn't installed on this instance" }];
    if (found.status === "disabled") return [{ key, reason: "is turned off for this instance" }];
    if (found.status === "incompatible") {
      return [{ key, reason: `can't run on this version of Bogey: ${found.detail ?? ""}`.trim() }];
    }
    if (settings.available && !settings.available.includes(key)) {
      return [{ key, reason: "isn't offered by this organization any more" }];
    }
    return [];
  });
}

export function eventPluginPath(slug: string, key: string, path = ""): string {
  return pluginPageUrl({ key }, "event", path, slug);
}

export interface PluginAreaLink {
  key: string;
  label: string;
  to: string;
  exact: boolean;
  permission?: string;
  pluginKey: string;
  path: string;
  window?: string;
}

// a route's `window` names one of the plugin's own windows by its short key, or a core one
function routeWindow(manifest: PluginManifest, window: string | undefined): string | undefined {
  if (!window) return undefined;
  return manifest.windows?.some((own) => own.key === window) ? `${manifest.key}.${window}` : window;
}

function manifestOf(plugins: Tuple<PluginManifest>, key: string): PluginManifest {
  const found = plugins.find((plugin) => plugin.key === key);
  if (!found) throw new Error(`Plugin "${key}" isn't among the plugins whose pages are listed.`);
  return found;
}

export function pluginAreaLinks(
  plugins: Tuple<PluginManifest>,
  area: PluginRouteArea,
  slug?: string,
  settings: Record<string, Record<string, unknown>> = {},
): PluginAreaLink[] {
  return pluginRoutes(plugins, area).flatMap((route) => {
    const manifest = manifestOf(plugins, route.key);
    if (!route.label || !isRouteListed(manifest, route, settings[route.key] ?? {})) return [];
    const window = routeWindow(manifest, route.window);
    return [
      {
        key: `plugin-${route.key}${route.path}`,
        label: route.label,
        to: pluginPageUrl(route, area, route.path, slug),
        exact: route.path === "",
        pluginKey: route.key,
        path: route.path,
        ...(route.permission ? { permission: route.permission } : {}),
        ...(window ? { window } : {}),
      },
    ];
  });
}

export function pluginTabs(
  slug: string,
  plugins: Tuple<PluginManifest>,
  settings: Record<string, Record<string, unknown>>,
): EventTab[] {
  return pluginAreaLinks(plugins, "event", slug, settings).map(({ permission, ...tab }) => ({
    ...tab,
    ...(permission ? { show: (viewer: EventViewer) => can(viewer.access, permission) } : {}),
  }));
}

export function pluginCommands(
  slug: string,
  plugins: Tuple<PluginManifest>,
): (EventTab & { keywords: Tuple<string> })[] {
  return plugins.flatMap((manifest) =>
    (manifest.commands ?? []).flatMap((command) => {
      if (command.path === undefined) return [];
      const path = command.path;
      const route = manifest.routes?.find((candidate) => candidate.path === path);
      return {
        key: `plugin-command-${manifest.key}${path}-${command.label}`,
        label: command.label,
        to: pluginPageUrl(manifest, route ? routeArea(route) : "event", path, slug),
        keywords: [command.label, manifest.name, ...(command.keywords ?? [])],
        ...(route?.permission
          ? { show: (viewer: EventViewer) => can(viewer.access, route.permission ?? "") }
          : {}),
      };
    }),
  );
}

const pluginKey = z.string().refine((key) => findPlugin(key) !== undefined, "Unknown plugin");

const ownScopeInput = z.object({
  scope: z.unknown(),
  orgId: z.unknown().optional(),
  eventId: z.unknown().optional(),
});

const settingsAt = z.object({
  key: pluginKey,
  eventId: z.string().optional(),
  orgId: z.string().optional(),
});

export interface PluginSettingsScope {
  eventId?: string;
  orgId?: string;
}

export const pluginSettingsFn = createServerFn({ method: "GET" })
  .validator(settingsAt)
  .handler(async ({ data }): Promise<DbResult<JsonRecord>> => {
    const supabase = createServerClient();
    const namespace = pluginNamespace({ key: data.key });
    const { data: resolved, error } = await supabase.rpc("settings_for", {
      p_namespaces: [namespace],
      ...(data.eventId ? { p_event: data.eventId } : data.orgId ? { p_org: data.orgId } : {}),
    });
    if (error) return toFailure(error, "loading the plugin's settings");
    return ok(jsonRecord(jsonRecord(resolved)[namespace]));
  });

export const pluginSettingsAtQueryOptions = (scope: PluginSettingsScope, key: string) =>
  queryOptions({
    queryKey: ["settings", "plugin", scope.orgId ?? null, scope.eventId ?? null, key] as const,
    queryFn: async () => unwrap(await pluginSettingsFn({ data: { ...scope, key } })),
    retry: retryPolicy,
  });

export const pluginOrgSettingsQueryOptions = (orgId: string, key: string) =>
  pluginSettingsAtQueryOptions({ orgId }, key);

export const pluginSettingsQueryOptions = (eventId: string, key: string) =>
  pluginSettingsAtQueryOptions({ eventId }, key);

export const ownPluginSettingsFn = createServerFn({ method: "GET" })
  .validator(
    ownScopeInput
      .extend({ key: pluginKey })
      .transform((raw) => ({ ...ownScope(raw), key: raw.key })),
  )
  .handler(async ({ data }): Promise<DbResult<JsonRecord>> => {
    const { data: row, error } = await readOwnSettings(data, pluginNamespace({ key: data.key }));
    if (error) return toFailure(error, "loading the plugin's settings");
    return ok(jsonRecord(row?.value));
  });

export const ownPluginSettingsQueryOptions = (scope: OwnScope, key: string) =>
  queryOptions({
    queryKey: [
      "settings",
      "plugin-own",
      scope.scope,
      scope.orgId ?? null,
      scope.eventId ?? null,
      key,
    ] as const,
    queryFn: async () => unwrap(await ownPluginSettingsFn({ data: { ...scope, key } })),
    retry: retryPolicy,
  });

export const savePluginSettingsFn = createServerFn({ method: "POST" })
  .validator(
    ownScopeInput
      .extend({ key: pluginKey, changes: z.record(z.string(), z.unknown()) })
      .transform((raw) => ({ ...ownScope(raw), key: raw.key, changes: raw.changes })),
  )
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const manifest = findPlugin(data.key);
    if (!manifest) return fail("not_found", "That plugin isn't installed.");
    const namespace = pluginNamespace(manifest);
    const editable = new Set(settingsEditableAt(manifest, data.scope).map(([name]) => name));
    const refused = Object.keys(data.changes).find((name) => !editable.has(name));
    if (refused) return fail("invalid", `"${refused}" can't be set here.`);

    const { data: row, error: readError } = await readOwnSettings(data, namespace);
    if (readError) return toFailure(readError, "saving the plugin's settings");
    const merged: Record<string, unknown> = { ...jsonRecord(row?.value), ...data.changes };
    for (const [name, value] of Object.entries(merged)) if (value === null) delete merged[name];
    const value = validPluginSettings(manifest, merged);
    if (Object.keys(value).length !== Object.keys(merged).length) {
      return fail("invalid", "One of those values doesn't fit the setting.");
    }

    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("settings").upsert(
      {
        scope: data.scope,
        org_id: data.orgId,
        event_id: data.eventId,
        namespace,
        value,
        updated_by: userData.user?.id ?? null,
      },
      { onConflict: "scope,org_id,event_id,namespace" },
    );
    if (error) return toFailure(error, "saving the plugin's settings");
    return ok(null);
  });

export function savePluginSettings(
  scope: OwnScope,
  key: string,
  changes: Record<string, unknown>,
): Promise<DbResult<null>> {
  return savePluginSettingsFn({ data: { ...scope, key, changes } }).catch(requestFailure);
}

export const pluginInstanceLimitsFn = createServerFn({ method: "GET" })
  .validator(z.object({ key: pluginKey }))
  .handler(async ({ data }): Promise<DbResult<Record<string, number>>> => {
    const manifest = findPlugin(data.key);
    if (!manifest) return fail("not_found", "That plugin isn't installed.");
    const { data: row, error } = await readOwnSettings(
      { scope: "instance", orgId: null, eventId: null },
      pluginLimitsNamespace(manifest),
    );
    if (error) return toFailure(error, "loading the plugin's limits");
    const stored = jsonRecord(row?.value);
    const out: Record<string, number> = {};
    for (const name of Object.keys(manifest.limits ?? {})) {
      const value = stored[name];
      if (typeof value === "number") out[name] = value;
    }
    return ok(out);
  });

export const pluginInstanceLimitsQueryOptions = (key: string) =>
  queryOptions({
    queryKey: ["instance", "plugin-limits", key] as const,
    queryFn: async () => unwrap(await pluginInstanceLimitsFn({ data: { key } })),
    retry: retryPolicy,
  });

export const savePluginInstanceLimitsFn = createServerFn({ method: "POST" })
  .validator(z.object({ key: pluginKey, limits: z.record(z.string(), z.unknown()) }))
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const manifest = findPlugin(data.key);
    if (!manifest) return fail("not_found", "That plugin isn't installed.");
    const value: Record<string, number> = {};
    for (const name of Object.keys(manifest.limits ?? {})) {
      const given = data.limits[name];
      if (given === null || given === undefined) continue;
      if (typeof given !== "number" || !Number.isInteger(given) || given < 0 || given > 1e12) {
        return fail("invalid", "Limits are whole numbers, or none.");
      }
      value[name] = given;
    }
    const supabase = createServerClient();
    const namespace = pluginLimitsNamespace(manifest);
    if (Object.keys(value).length === 0) {
      const { error } = await supabase
        .from("settings")
        .delete()
        .eq("scope", "instance")
        .eq("namespace", namespace);
      if (error) return toFailure(error, "saving the limits");
      return ok(null);
    }
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("settings")
      .upsert(
        { scope: "instance", namespace, value, updated_by: userData.user?.id ?? null },
        { onConflict: "scope,org_id,event_id,namespace" },
      );
    if (error) return toFailure(error, "saving the limits");
    return ok(null);
  });
