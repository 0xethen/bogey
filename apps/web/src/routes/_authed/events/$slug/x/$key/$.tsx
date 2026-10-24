import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { can } from "@bogey/db/permissions";
import { readPluginSettings } from "@bogey/plugins";
import { pluginSettingsQueryOptions } from "#/lib/plugins.ts";
import { msg } from "#/lib/translate.tsx";
import { findPluginPage, loadPluginPage, PluginPage } from "#/lib/plugin-pages.tsx";

export const Route = createFileRoute("/_authed/events/$slug/x/$key/$")({
  staticData: { title: msg("page.plugin") },
  beforeLoad: ({ context, params }) => {
    const page = findPluginPage(context.plugins, "event", params);
    if (page.permission && !can(context.access, page.permission)) throw notFound();
    return { page };
  },
  loader: async ({ context }) => {
    const { page, event, session, query } = context;
    const stored = await query.query({
      ...pluginSettingsQueryOptions(event.id, page.manifest.key),
      staleTime: "static",
    });
    return loadPluginPage(
      "event",
      page,
      {
        eventId: event.id,
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
  const { event, page, session } = Route.useRouteContext();
  const { data: stored } = useSuspenseQuery(
    pluginSettingsQueryOptions(event.id, page.manifest.key),
  );
  return (
    <PluginPage
      area="event"
      page={page}
      context={{
        eventId: event.id,
        settings: readPluginSettings(page.manifest, stored),
        session,
        splat: page.splat,
      }}
    />
  );
}
