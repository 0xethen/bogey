import { useSuspenseQuery } from "@tanstack/react-query";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import {
  installedPlugins,
  pluginTogglesPerEvent,
  settingsEditableAt,
  settingsLockedAbove,
} from "@bogey/plugins";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { IconPuzzle } from "@tabler/icons-react";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import { PluginSettings } from "#/components/settings/sections/plugin-settings.tsx";
import { pluginAdds } from "#/components/settings/sections/plugin-facts.tsx";
import { useSettingsMutation } from "#/lib/settings.ts";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import { useT } from "#/lib/translate.tsx";

export function OrgPlugins({ orgId }: { orgId: string }) {
  const t = useT();
  const scope = { scope: "org", orgId } as const;
  const { data: own } = useSuspenseQuery(ownSettingsQueryOptions(scope, "plugins"));
  const save = useSettingsMutation(scope, "plugins");
  const plugins = installedPlugins();
  const [available, setAvailable] = useDraft(
    own.available ?? plugins.map((manifest) => manifest.key),
    async (next) => {
      try {
        await save.mutateAsync({ available: next.length === plugins.length ? null : next });
        return true;
      } catch {
        return false;
      }
    },
    sameKeys,
  );
  if (plugins.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconPuzzle />
          </EmptyMedia>
          <EmptyTitle>{t("orgExt.noneTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("orgExt.none")}{" "}
            <a href="docs/plugins.md" className="link">
              {t("orgExt.noneLink")}
            </a>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const toggle = (key: string, on: boolean) =>
    setAvailable(on ? [...new Set([...available, key])] : available.filter((k) => k !== key));

  return (
    <Screen.Section
      id="offered-to-events"
      title={t("orgExt.offered")}
      description={t("orgExt.offeredHelp")}
    >
      <ErrorAlert error={save.error} title={t("orgExt.changeFailed")} />
      <DisclosureList>
        {plugins.map((manifest) => (
          <DisclosureRow
            key={manifest.key}
            title={manifest.name}
            meta={`${manifest.description} ${pluginAdds(manifest, t)}.`}
            actions={
              <Switch
                aria-label={
                  pluginTogglesPerEvent(manifest)
                    ? t("orgExt.offer", { name: manifest.name })
                    : t("orgExt.letAdmins", { name: manifest.name })
                }
                checked={available.includes(manifest.key)}
                onCheckedChange={(checked) => toggle(manifest.key, checked)}
              />
            }
          >
            {settingsEditableAt(manifest, "org").length +
              settingsLockedAbove(manifest, "org").length >
            0 ? (
              <PluginSettings scope={scope} manifest={manifest} />
            ) : (
              <p className="text-sm text-muted-fg">{t("orgExt.nothing")}</p>
            )}
          </DisclosureRow>
        ))}
      </DisclosureList>
    </Screen.Section>
  );
}

function sameKeys(a: Tuple<string>, b: Tuple<string>): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}
