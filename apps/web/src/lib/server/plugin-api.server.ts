import { createServerClient, createServerClientFor } from "@bogey/db/server";
import { resolveSettings } from "@bogey/config/settings";
import { jsonRecord } from "@bogey/db/types";
import { findPlugin, loadPluginRuntime, type PluginServerContext } from "@bogey/plugins";
import { enabledPlugins } from "#/lib/plugins.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_METHODS = ["GET", "HEAD"];
export const MAX_BODY_BYTES = 1_000_000;

export class BodyTooLarge extends Error {}

export async function readLimited(request: Request, max: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function bodyLimit(
  routes: Tuple<{ method: string; path: string; maxBodyMb?: number }> | undefined,
  id: string,
): number {
  const route = (routes ?? []).find((each) => `${each.method} ${each.path}` === id);
  return route?.maxBodyMb ? route.maxBodyMb * 1_000_000 : MAX_BODY_BYTES;
}

const NO_CACHE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_CACHE });
}

export function crossSiteProblem(request: Request): string | null {
  if (SAFE_METHODS.includes(request.method)) return null;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return "cross-site request";
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
      if (new URL(origin).host !== host) return "cross-site request";
    } catch {
      return "cross-site request";
    }
  }
  return null;
}

const PARAM_VALUE = /^[A-Za-z0-9_-]{1,100}$/;

export function declaredRoute(
  routes: Tuple<{ method: string; path: string }> | undefined,
  method: string,
  splat: string,
): { id: string; params: Record<string, string> } | null {
  const path = splat ? `/${splat.replace(/^\/+|\/+$/g, "")}` : "/";
  const wanted = method === "HEAD" ? "GET" : method;
  const candidates = (routes ?? []).filter((route) => route.method === wanted);
  const exact = candidates.find((route) => route.path === path);
  if (exact) return { id: `${exact.method} ${exact.path}`, params: {} };
  const parts = path.split("/").slice(1);
  for (const route of candidates) {
    const pattern = route.path.split("/").slice(1);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = pattern.every((segment, index) => {
      const part = parts[index] ?? "";
      if (!segment.startsWith(":")) return segment === part;
      if (!PARAM_VALUE.test(part)) return false;
      params[segment.slice(1)] = part;
      return true;
    });
    if (fits) return { id: `${route.method} ${route.path}`, params };
  }
  return null;
}

export function sanitize(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const [name, value] of Object.entries(NO_CACHE))
    if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function eventIdFor(
  supabase: PluginServerContext["supabase"],
  key: string,
  raw: string | null,
): Promise<string | null | "missing"> {
  if (raw === null) return null;
  if (!UUID.test(raw)) return "missing";
  const { data: event } = await supabase.from("events").select("id").eq("id", raw).maybeSingle();
  if (!event) return "missing";
  const { data: resolved } = await supabase.rpc("settings_for", {
    p_namespaces: ["plugins"],
    p_event: raw,
  });
  const settings = resolveSettings("plugins", jsonRecord(resolved).plugins);
  return enabledPlugins(settings).some((plugin) => plugin.key === key) ? raw : "missing";
}

export async function pluginApiResponse(
  request: Request,
  key: string,
  splat: string,
): Promise<Response> {
  const manifest = findPlugin(key);
  if (!manifest) return json(404, "not found");
  const declared = declaredRoute(manifest.serverRoutes, request.method, splat);
  if (!declared) return json(404, "not found");
  const { id, params } = declared;
  const problem = crossSiteProblem(request);
  if (problem) return json(403, problem);
  const limit = bodyLimit(manifest.serverRoutes, id);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > limit) return json(413, "too large");

  const runtime = await loadPluginRuntime(key).catch((error: unknown) => {
    console.error(`[bogey] plugin "${key}" failed to load:`, error);
    return undefined;
  });
  const handler = runtime?.serverRoutes[id];
  if (!handler) return json(501, "not implemented");

  const supabase = createServerClient();
  const url = new URL(request.url);
  const eventId = await eventIdFor(supabase, key, url.searchParams.get("event"));
  if (eventId === "missing") return json(404, "not found");
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user ? { id: userData.user.id, email: userData.user.email ?? null } : null;

  try {
    const response = await handler(request, {
      supabase,
      supabaseFor: createServerClientFor,
      user,
      eventId,
      params,
      path: splat ? `/${splat.replace(/^\/+|\/+$/g, "")}` : "/",
      body: () => readLimited(request, limit),
    });
    return sanitize(response);
  } catch (error) {
    if (error instanceof BodyTooLarge) return json(413, "too large");
    console.error(`[bogey] plugin "${key}" route ${id} failed:`, error);
    return json(500, "failed");
  }
}
