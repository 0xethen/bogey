import { createFileRoute } from "@tanstack/react-router";
import { IconPuzzle } from "@tabler/icons-react";
import { loadedPluginSlots, readPluginSettings } from "@bogey/plugins";
import { msg, useT } from "#/lib/translate.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { Screen } from "@bogey/ui/components/screen";

export const Route = createFileRoute("/_authed/account/plugins")({
  staticData: { title: msg("accountNav.plugins") },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { session } = Route.useRouteContext();
  const panels = loadedPluginSlots().flatMap(({ key, manifest, slots }) => {
    const Panel = slots.preferencesPanel;
    return Panel ? [{ key, manifest, Panel }] : [];
  });
  return (
    <Screen title={t("accountNav.plugins")} width="embedded">
      {panels.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconPuzzle />
            </EmptyMedia>
            <EmptyTitle>{t("plugins.noneTitle")}</EmptyTitle>
            <EmptyDescription>{t("plugins.none")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {panels.map(({ key, manifest, Panel }) => (
        <Screen.Section key={key} title={manifest.name}>
          <Panel settings={readPluginSettings(manifest, {})} session={session} />
        </Screen.Section>
      ))}
    </Screen>
  );
}
