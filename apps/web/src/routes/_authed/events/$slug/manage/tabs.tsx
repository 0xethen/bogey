import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { IconArrowBack, IconClock, IconEyeOff } from "@tabler/icons-react";
import type { EventTabSetting } from "@bogey/config/settings";
import type { PluginManifest } from "@bogey/plugins";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@bogey/ui/components/native-select";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import {
  arrangeTabs,
  CORE_TAB_AUDIENCE,
  eventTabs,
  isArrangeable,
  PINNED_TAB,
  tabSetting,
  type ArrangedTab,
} from "#/lib/event-tabs.ts";
import { useSettingsMutation } from "#/lib/settings.ts";
import { windowLabel } from "#/lib/windows.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/tabs")({
  staticData: {
    title: msg("manageTabs.title"),
    settings: (t) => [
      searchSection(t("manageTabs.listTitle"), {
        id: "tabs.items",
        keywords: ["navigation", "order", "hide", "rename", "window"],
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(settingsQueryOptions({ eventId: context.event.id }, ["tabs"])),
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const same = (a: Tuple<EventTabSetting>, b: Tuple<EventTabSetting>) =>
  JSON.stringify(a) === JSON.stringify(b);

function RouteComponent() {
  const t = useT();
  const { event, plugins, pluginSettings } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["tabs"]),
  );
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "tabs");
  const [editing, setEditing] = useState<string | null>(null);

  const base = useMemo(
    () => eventTabs(event.slug, plugins, pluginSettings, [], t).filter(isArrangeable),
    [event.slug, plugins, pluginSettings, t],
  );
  // every tab in order with only what differs from how it comes, so equal arrangements compare equal
  const normalize = (items: Tuple<EventTabSetting>) =>
    arrangeTabs(base, items).flatMap((tab) => {
      const own = base.find((each) => each.key === tab.key);
      return own ? [tabSetting(tab, own)] : [];
    });
  const [items, setItems] = useDraft(
    normalize(settings.tabs.items),
    async (next) => {
      try {
        await save.mutateAsync({ items: [...next] });
        return true;
      } catch {
        return false;
      }
    },
    same,
  );
  const tabs = arrangeTabs(base, items);
  const change = (key: string, patch: Partial<ArrangedTab>) =>
    setItems(
      normalize(
        tabs.map((tab) => {
          const own = base.find((each) => each.key === tab.key);
          const next = tab.key === key ? { ...tab, ...patch } : tab;
          return own ? tabSetting(next, own) : { key: tab.key };
        }),
      ),
    );
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    setItems(normalize(next));
  };

  return (
    <Screen
      title={t("manageTabs.title")}
      description={t("manageTabs.intro")}
      width="embedded"
      actions={
        <Button
          variant="outline"
          disabled={same(items, normalize([]))}
          onClick={() => setItems(normalize([]))}
        >
          <IconArrowBack />
          {t("manageTabs.reset")}
        </Button>
      }
    >
      <Screen.Section
        id="tabs.items"
        title={t("manageTabs.listTitle")}
        description={t("manageTabs.listHelp")}
      >
        <EditableList onMove={move}>
          {tabs.map((tab, index) => (
            <EditableListItem
              key={tab.key}
              id={tab.key}
              index={index}
              noun={tab.label}
              numbered={false}
              editWith="button"
              editing={editing === tab.key}
              onEdit={() => setEditing(tab.key)}
              onDone={() => setEditing(null)}
              preview={<TabPreview tab={tab} plugins={plugins} />}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`tab-${tab.key}-label`}>{t("manageTabs.name")}</FieldLabel>
                  <Input
                    id={`tab-${tab.key}-label`}
                    value={tab.label === tab.defaultLabel ? "" : tab.label}
                    placeholder={tab.defaultLabel}
                    maxLength={40}
                    onChange={(changed) =>
                      change(tab.key, { label: changed.target.value || tab.defaultLabel })
                    }
                  />
                </Field>
                {tab.key !== PINNED_TAB && (
                  <Field>
                    <FieldLabel htmlFor={`tab-${tab.key}-window`}>
                      {t("manageTabs.window")}
                    </FieldLabel>
                    <NativeSelect
                      id={`tab-${tab.key}-window`}
                      className="w-full"
                      value={tab.window ?? ""}
                      onChange={(changed) =>
                        change(tab.key, { window: changed.target.value || undefined })
                      }
                    >
                      <NativeSelectOption value="">{t("manageTabs.always")}</NativeSelectOption>
                      {[
                        ...windows.map((window) => window.key),
                        ...(tab.window && !windows.some((window) => window.key === tab.window)
                          ? [tab.window]
                          : []),
                      ].map((key) => (
                        <NativeSelectOption key={key} value={key}>
                          {t("manageTabs.whileOpen", { window: windowLabel({ key }, t) })}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>
                      <Linked
                        text={t("manageTabs.windowHelp", { agenda: LINK })}
                        links={[
                          <SettingLink
                            key="agenda"
                            to={`/events/${event.slug}/manage/agenda`}
                            hash="windows"
                          >
                            {t("path.agenda")}
                          </SettingLink>,
                        ]}
                      />
                    </FieldDescription>
                  </Field>
                )}
              </div>
              {tab.key !== PINNED_TAB && (
                <Field orientation="horizontal">
                  <Switch
                    id={`tab-${tab.key}-shown`}
                    checked={!tab.hidden}
                    onCheckedChange={(checked) => change(tab.key, { hidden: !checked })}
                  />
                  <FieldLabel htmlFor={`tab-${tab.key}-shown`} className="font-normal">
                    {t("manageTabs.shown")}
                  </FieldLabel>
                </Field>
              )}
            </EditableListItem>
          ))}
        </EditableList>
        <ErrorAlert error={save.error} title={t("manageTabs.saveFailed")} />
      </Screen.Section>
    </Screen>
  );
}

function TabPreview({ tab, plugins }: { tab: ArrangedTab; plugins: Tuple<PluginManifest> }) {
  const t = useT();
  const audience = CORE_TAB_AUDIENCE[tab.key];
  const plugin = plugins.find(
    (each) => tab.key === `plugin-${each.key}` || tab.key.startsWith(`plugin-${each.key}/`),
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className={tab.hidden ? "font-medium text-muted-fg line-through" : "font-medium"}>
        {tab.label}
      </span>
      {tab.label !== tab.defaultLabel && (
        <span className="text-xs text-muted-fg">{tab.defaultLabel}</span>
      )}
      <span className="text-xs text-muted-fg">
        {audience ? t(audience) : plugin ? t("manageTabs.fromPlugin", { plugin: plugin.name }) : ""}
      </span>
      {tab.hidden && (
        <Badge variant="secondary">
          <IconEyeOff />
          {t("manageTabs.hidden")}
        </Badge>
      )}
      {tab.window && !tab.hidden && (
        <Badge variant="outline">
          <IconClock />
          {t("manageTabs.whileOpen", { window: windowLabel({ key: tab.window }, t) })}
        </Badge>
      )}
    </div>
  );
}
