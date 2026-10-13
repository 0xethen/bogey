import { use } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import {
  installedPlugins,
  pluginTogglesPerEvent,
  loadPluginRuntime,
  pluginRepositoryUrl,
  generalSettingNames,
  readPluginSettings,
  type PluginManifest,
} from "@bogey/plugins";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import { PluginSettings } from "#/components/settings/sections/plugin-settings.tsx";
import { PluginSectionLinks } from "#/components/settings/sections/plugin-sections.tsx";
import { managePageLabel } from "#/lib/manage-pages.ts";
import {
  missingPlugins,
  ownPluginSettingsQueryOptions,
  pluginSettingsQueryOptions,
} from "#/lib/plugins.ts";
import { useSettingsMutation } from "#/lib/settings.ts";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/plugins")({
  staticData: { title: msg("accountNav.plugins") },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["plugins"]),
      ),
      ...installedPlugins().map((manifest) =>
        context.query.ensureQueryData(
          ownPluginSettingsQueryOptions(
            { scope: "event", eventId: context.event.id },
            manifest.key,
          ),
        ),
      ),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["plugins"]),
  );
  const router = useRouter();
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "plugins");
  const { enabled, available } = settings.plugins;
  const offered = installedPlugins().filter(
    (manifest) =>
      (manifest.locales?.length ?? 0) === 0 &&
      (!available || available.includes(manifest.key)) &&
      (pluginTogglesPerEvent(manifest) || enabled.includes(manifest.key)),
  );

  const toggle = (key: string, on: boolean) =>
    save.mutate(
      {
        enabled: on
          ? [...new Set([...enabled, key])]
          : enabled.filter((existing) => existing !== key),
      },
      { onSuccess: () => router.invalidate() },
    );

  return (
    <Screen title={t("accountNav.plugins")} description={t("eventExt.intro")} width="embedded">
      <ErrorAlert error={save.error} title={t("orgExt.changeFailed")} />
      {missingPlugins(settings.plugins).length > 0 && (
        <Screen.Section
          id="not-running"
          title={t("eventExt.notRunning")}
          description={t("eventExt.notRunningHelp")}
        >
          <DisclosureList>
            {missingPlugins(settings.plugins).map((each) => (
              <DisclosureRow
                key={each.key}
                title={<code>{each.key}</code>}
                meta={t("eventExt.thisPlugin", { reason: each.reason })}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={save.isPending}
                    confirm={{
                      title: t("eventExt.removeTitle", { key: each.key }),
                      description: t("eventExt.removeBody"),
                      label: t("twoFactor.remove"),
                    }}
                    onClick={() => toggle(each.key, false)}
                  >
                    {t("twoFactor.removeButton")}
                  </Button>
                }
              />
            ))}
          </DisclosureList>
        </Screen.Section>
      )}
      {offered.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("eventExt.none")}</p>
      ) : (
        <DisclosureList>
          {offered.map((manifest) => {
            const on = enabled.includes(manifest.key);
            const repository = pluginRepositoryUrl(manifest);
            return (
              <DisclosureRow
                key={manifest.key}
                title={
                  <>
                    {manifest.name} <span className="font-normal">v{manifest.version}</span>
                    {on && (
                      <Badge variant="secondary" className="ml-2">
                        {t("eventExt.on")}
                      </Badge>
                    )}
                  </>
                }
                meta={`${manifest.author.name} • ${manifest.description || t("eventExt.noDescription")}`}
                actions={
                  pluginTogglesPerEvent(manifest) ? (
                    <Switch
                      aria-label={t("eventExt.onFor", { name: manifest.name })}
                      checked={on}
                      disabled={save.isPending}
                      onCheckedChange={(checked) => toggle(manifest.key, checked)}
                    />
                  ) : (
                    <Badge
                      title={t("eventExt.typeFrom", { name: manifest.name })}
                      variant="outline"
                    >
                      {t("agenda.required")}
                    </Badge>
                  )
                }
              >
                <div className="flex flex-col gap-6">
                  {repository && (
                    <a className="link text-sm" href={repository} target="_blank" rel="noreferrer">
                      {t("adminExt.source")}
                    </a>
                  )}
                  <PluginSettings
                    scope={{ scope: "event", eventId: event.id }}
                    manifest={manifest}
                    only={generalSettingNames(manifest)}
                  />
                  <PluginSectionLinks
                    manifest={manifest}
                    slug={event.slug}
                    pageLabel={(page) => managePageLabel(t, page)}
                  />
                  {on && <OrganizerPanel manifest={manifest} />}
                </div>
              </DisclosureRow>
            );
          })}
        </DisclosureList>
      )}
    </Screen>
  );
}

function OrganizerPanel({ manifest }: { manifest: PluginManifest }) {
  const { event, session } = Route.useRouteContext();
  const runtime = use(loadPluginRuntime(manifest.key));
  const { data: stored } = useSuspenseQuery(pluginSettingsQueryOptions(event.id, manifest.key));
  const Panel = runtime?.slots.organizerPanel;
  return Panel ? (
    <Panel eventId={event.id} settings={readPluginSettings(manifest, stored)} session={session} />
  ) : null;
}
