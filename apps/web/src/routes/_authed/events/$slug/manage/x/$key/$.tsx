import { createFileRoute, notFound } from "@tanstack/react-router";
import { msg } from "#/lib/translate.tsx";
import { useSuspenseQuery } from "@tanstack/react-query";
import { can } from "@bogey/db/permissions";
import { readPluginSettings, type PluginManifest, type PluginSettingsPage } from "@bogey/plugins";
import { Screen } from "@bogey/ui/components/screen";
import { pluginSettingsQueryOptions } from "#/lib/plugins.ts";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";
import {
  findPluginPage,
  loadPluginPage,
  PluginPage,
  type FoundPluginPage,
} from "#/lib/plugin-pages.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/x/$key/$")({
  staticData: { title: msg("plugin.one") },
  beforeLoad: ({ context, params }) => {
    const manifest = context.plugins.find((each) => each.key === params.key);
    const own = manifest?.settingsPages?.find(
      (each) => each.route === undefined && each.key === params._splat,
    );
    if (manifest && own) return { target: { kind: "settings", manifest, own } as const };
    const page = findPluginPage(context.plugins, "manage", params);
    if (page.permission && !can(context.access, page.permission)) throw notFound();
    return { target: { kind: "page", page } as const };
  },
  loader: async ({ context }) => {
    const { target, event, session, query } = context;
    if (target.kind === "settings") return { title: target.own.label };
    const { page } = target;
    const stored = await query.query({
      ...pluginSettingsQueryOptions(event.id, page.manifest.key),
      staleTime: "static",
    });
    return loadPluginPage(
      "manage",
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
  const { target } = Route.useRouteContext();
  return target.kind === "settings" ? (
    <OwnSettingsPage manifest={target.manifest} own={target.own} />
  ) : (
    <PluginSettingsPage page={target.page} />
  );
}

function OwnSettingsPage({ manifest, own }: { manifest: PluginManifest; own: PluginSettingsPage }) {
  return (
    <Screen title={own.label} description={own.description ?? manifest.name} width="embedded">
      <PluginSettingSections page={`${manifest.key}:${own.key}`} />
    </Screen>
  );
}

function PluginSettingsPage({ page }: { page: FoundPluginPage }) {
  const { event, session } = Route.useRouteContext();
  const { data: stored } = useSuspenseQuery(
    pluginSettingsQueryOptions(event.id, page.manifest.key),
  );
  const hosted = page.manifest.settingsPages?.find((each) => each.route === page.pluginPath);
  return (
    <PluginPage
      area="manage"
      page={page}
      context={{
        eventId: event.id,
        settings: readPluginSettings(page.manifest, stored),
        session,
        splat: page.splat,
        settingsSections: hosted ? (
          <PluginSettingSections page={`${page.manifest.key}:${hosted.key}`} />
        ) : undefined,
      }}
    />
  );
}
