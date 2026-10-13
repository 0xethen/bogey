import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { updateChecksEnabled } from "@bogey/config";
import { createServerClient } from "@bogey/db/server";
import { fail, ok, toFailure, unwrap, type DbResult } from "@bogey/db/errors";
import { getOrgFn } from "@bogey/db/tenant";
import { installedPlugins, isBundledPlugin } from "./registry.ts";
import { checkPluginUpdates, httpFetcher, type PluginUpdate } from "./updates.ts";

export const checkPluginUpdatesFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<DbResult<PluginUpdate[]>> => {
    const supabase = createServerClient();

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "You need to be signed in.");

    const [org, admin] = await Promise.all([
      getOrgFn(),
      supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle(),
    ]);
    if (admin.error) return toFailure(admin.error, "checking your role");
    let allowed = !!admin.data;
    if (!allowed && org.ok && org.data) {
      const { data: membership, error } = await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", org.data.id)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (error) return toFailure(error, "checking your role");
      allowed = membership?.role === "admin" || membership?.role === "owner";
    }
    if (!allowed) return fail("forbidden", "Only an organizer can check for plugin updates.");

    const plugins = installedPlugins().filter((manifest) => !isBundledPlugin(manifest.key));
    if (!updateChecksEnabled()) {
      return ok(
        plugins.map((manifest) => ({
          key: manifest.key,
          name: manifest.name,
          installed: manifest.version,
          state: "unknown",
          detail: "Update checks are turned off for this instance.",
        })),
      );
    }
    return ok(await checkPluginUpdates(plugins, httpFetcher));
  },
);

export const pluginUpdatesQueryOptions = () =>
  queryOptions({
    queryKey: ["plugin-updates"] as const,
    queryFn: async () => unwrap(await checkPluginUpdatesFn()),
    enabled: false,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });
