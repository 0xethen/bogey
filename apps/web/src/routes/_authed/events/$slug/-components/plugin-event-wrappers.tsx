import type { ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { Session } from "@bogey/db/auth";
import { can, useEventAccess } from "@bogey/db/permissions";
import { loadedPluginSlots, readPluginSettings, type PluginManifest } from "@bogey/plugins";
import { PluginBoundary } from "#/components/plugins/plugin-boundary.tsx";
import { pluginSettingsQueryOptions } from "#/lib/plugins.ts";
import { useT } from "#/lib/translate.tsx";
import { useEventViewer } from "#/lib/viewer.ts";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";

export function eventWrapperPlugins(plugins: Tuple<PluginManifest>): PluginManifest[] {
  const wrapping = new Set(
    loadedPluginSlots()
      .filter((loaded) => loaded.slots.eventWrapper)
      .map((loaded) => loaded.key),
  );
  return plugins.filter((plugin) => wrapping.has(plugin.key));
}

function EventWrapper({
  manifest,
  eventId,
  session,
  children,
}: {
  manifest: PluginManifest;
  eventId: string;
  session: Session;
  children: ReactNode;
}) {
  const t = useT();
  const { data: stored } = useSuspenseQuery(pluginSettingsQueryOptions(eventId, manifest.key));
  const manages = can(useEventAccess(), "event.manage");
  const slug = useEventViewer()?.event.slug ?? "";
  const Wrapper = loadedPluginSlots().find((loaded) => loaded.key === manifest.key)?.slots
    .eventWrapper;
  if (!Wrapper) return children;
  return (
    <PluginBoundary
      name={manifest.name}
      detail={manages}
      note={
        manages ? (
          <Linked
            text={t("event.wrapperBroken", { plugins: LINK })}
            links={[
              <SettingLink
                key="plugins"
                to={`/events/${slug}/manage/plugins`}
                hash={`plugins.${manifest.key}`}
              >
                {t("event.managePlugins")}
              </SettingLink>,
            ]}
          />
        ) : (
          t("event.wrapperPaused")
        )
      }
      recover={manages ? children : null}
    >
      <Wrapper eventId={eventId} settings={readPluginSettings(manifest, stored)} session={session}>
        {children}
      </Wrapper>
    </PluginBoundary>
  );
}

export function PluginEventWrappers({
  plugins,
  eventId,
  session,
  children,
}: {
  plugins: Tuple<PluginManifest>;
  eventId: string;
  session: Session;
  children: ReactNode;
}) {
  return eventWrapperPlugins(plugins).reduceRight<ReactNode>(
    (inner, manifest) => (
      <EventWrapper key={manifest.key} manifest={manifest} eventId={eventId} session={session}>
        {inner}
      </EventWrapper>
    ),
    children,
  );
}
