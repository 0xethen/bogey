import { createFileRoute } from "@tanstack/react-router";
import { msg } from "#/lib/translate.tsx";
import { useSuspenseQuery } from "@tanstack/react-query";
import { installedPlugins, readPluginSettings } from "@bogey/plugins";
import { pluginSettingsAtQueryOptions } from "#/lib/plugins.ts";
import { findPluginPage, loadPluginPage, PluginPage } from "#/lib/plugin-pages.tsx";

export const Route = createFileRoute("/_authed/admin/x/$key/$")({
  staticData: { title: msg("plugin.one") },
  beforeLoad: ({ params }) => ({ page: findPluginPage(installedPlugins(), "admin", params) }),
  loader: async ({ context }) => {
    const { page, session, query } = context;
    const stored = await query.query({
      ...pluginSettingsAtQueryOptions({}, page.manifest.key),
      staleTime: "static",
    });
    return loadPluginPage(
      "admin",
      page,
      { settings: readPluginSettings(page.manifest, stored), session, splat: page.splat },
      query,
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { page, session } = Route.useRouteContext();
  const { data: stored } = useSuspenseQuery(pluginSettingsAtQueryOptions({}, page.manifest.key));
  return (
    <PluginPage
      area="admin"
      page={page}
      context={{ settings: readPluginSettings(page.manifest, stored), session, splat: page.splat }}
    />
  );
}
