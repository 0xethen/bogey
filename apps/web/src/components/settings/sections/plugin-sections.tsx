import { getRouteApi, Link } from "@tanstack/react-router";
import {
  pluginPageUrl,
  settingsPresetsOn,
  settingsSectionsOn,
  type PluginManifest,
} from "@bogey/plugins";
import { Badge } from "@bogey/ui/components/badge";
import { Screen } from "@bogey/ui/components/screen";
import { PluginPresets } from "./plugin-presets.tsx";
import { PluginSettings } from "./plugin-settings.tsx";
import { useT } from "#/lib/translate.tsx";

const eventRoute = getRouteApi("/_authed/events/$slug");

export function PluginSettingSections({ page }: { page: string }) {
  const { event, plugins } = eventRoute.useRouteContext();
  const eventId = event.id;
  const sections = settingsSectionsOn(plugins, page);
  const presets = settingsPresetsOn(plugins, page).map(({ manifest, presets }) => (
    <PluginPresets key={`${manifest.key}-presets`} manifest={manifest} presets={presets} />
  ));
  return [
    ...presets,
    ...sections.map(({ manifest, section }) => (
      <Screen.Section
        key={`${manifest.key}-${section.key}`}
        id={`${manifest.key}-${section.key}`}
        title={section.title}
        description={section.description}
        actions={<Badge variant="outline">{manifest.name}</Badge>}
      >
        <PluginSettings
          scope={{ scope: "event", eventId }}
          manifest={manifest}
          only={section.settings}
        />
      </Screen.Section>
    )),
  ];
}

export function PluginSectionLinks({
  manifest,
  slug,
  pageLabel,
}: {
  manifest: PluginManifest;
  slug: string;
  pageLabel: (page: string) => string | undefined;
}) {
  const t = useT();
  const sections = manifest.settingsSections ?? [];
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted-fg">{t("eventExt.moreSettings")}</p>
      <ul className="flex flex-col gap-1">
        {sections.map((section) => {
          const own = manifest.settingsPages?.find((page) => page.key === section.page);
          const route =
            own?.route === undefined
              ? undefined
              : manifest.routes?.find((each) => each.path === own.route);
          const to = !own
            ? `/events/${slug}/manage/${section.page}`
            : own.route === undefined
              ? pluginPageUrl(manifest, "manage", `/${own.key}`, slug)
              : pluginPageUrl(manifest, "manage", own.route, slug);
          const where = route?.label ?? own?.label ?? pageLabel(section.page) ?? section.page;
          return (
            <li key={section.key}>
              <Link className="link" to={to} hash={`${manifest.key}-${section.key}`}>
                {where} → {section.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
