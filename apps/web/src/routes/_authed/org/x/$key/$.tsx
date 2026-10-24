import { createFileRoute } from "@tanstack/react-router";
import { msg } from "#/lib/translate.tsx";
import { useSuspenseQuery } from "@tanstack/react-query";
import { readPluginSettings } from "@bogey/plugins";
import { offeredPlugins, pluginSettingsAtQueryOptions } from "#/lib/plugins.ts";
import { findPluginPage, loadPluginPage, PluginPage } from "#/lib/plugin-pages.tsx";
import { settingsQueryOptions } from "@bogey/db/queries/settings";

export const Route = createFileRoute("/_authed/org/x/$key/$")({
  staticData: { title: msg("plugin.one") },
  beforeLoad: async ({ context, params }) => {
    const { plugins } = await context.query.query({
      ...settingsQueryOptions({ orgId: context.org.id }, ["plugins"]),
      staleTime: "static",
    });
    return { page: findPluginPage(offeredPlugins(plugins), "org", params) };
  },
  loader: async ({ context }) => {
    const { page, org, session, query } = context;
    const stored = await query.query({
      ...pluginSettingsAtQueryOptions({ orgId: org.id }, page.manifest.key),
      staleTime: "static",
    });
    return loadPluginPage(
      "org",
      page,
      {
        orgId: org.id,
        settings: readPluginSettings(page.manifest, stored),
        session,
        splat: page.splat,
      },
      query,
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { org, page, session } = Route.useRouteContext();
  const { data: stored } = useSuspenseQuery(
    pluginSettingsAtQueryOptions({ orgId: org.id }, page.manifest.key),
  );
  return (
    <PluginPage
      area="org"
      page={page}
      context={{
        orgId: org.id,
        settings: readPluginSettings(page.manifest, stored),
        session,
        splat: page.splat,
      }}
    />
  );
}
