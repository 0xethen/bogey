import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  IconArrowBack,
  IconCheck,
  IconClock,
  IconEyeOff,
  IconPlus,
  IconWorld,
} from "@tabler/icons-react";
import type { EventTabSetting } from "@bogey/config/settings";
import type { PluginManifest } from "@bogey/plugins";
import { requestFailure } from "@bogey/db/errors";
import { eventPagesQueryOptions, savePagesFn, type EventPage } from "@bogey/db/queries/pages";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { eventWindowsQueryOptions, type EventWindow } from "@bogey/db/queries/windows";
import { SLUG, toSlug } from "@bogey/utils/keys";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Panel } from "@bogey/ui/components/panel";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import {
  arrangeTabs,
  CORE_TAB_AUDIENCE,
  eventTabs,
  isArrangeable,
  NO_MENUS,
  PINNED_TAB,
  tabSetting,
  type ArrangedTab,
} from "#/lib/event-tabs.ts";
import { useSettingsMutation } from "#/lib/settings.ts";
import { windowLabel } from "#/lib/windows.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";
import { loadPrizes, PrizesSections, prizesSearch } from "./-components/prizes-editor.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/pages")({
  staticData: {
    title: msg("managePages.title"),
    settings: (t) => [
      searchSection(t("manageTabs.listTitle"), {
        id: "tabs.items",
        keywords: ["navigation", "order", "hide", "rename", "window"],
      }),
      searchSection(t("managePages.listTitle"), {
        id: "pages",
        keywords: ["custom", "information", "faq", "rules", "markdown"],
      }),
      ...prizesSearch(t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(settingsQueryOptions({ eventId: context.event.id }, ["tabs"])),
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPagesQueryOptions(context.event.id)),
      loadPrizes(context.query, context.event.id),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  return (
    <Screen title={t("managePages.title")} description={t("managePages.intro")} width="embedded">
      <Tabs />
      <Pages />
      <PrizesSections eventId={event.id} />
    </Screen>
  );
}

const same = (a: Tuple<EventTabSetting>, b: Tuple<EventTabSetting>) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A window select's options: every window the event has, plus one it no longer has but is chosen. */
function windowKeys(windows: Tuple<EventWindow>, chosen: string | null | undefined): string[] {
  return [
    ...windows.map((window) => window.key),
    ...(chosen && !windows.some((window) => window.key === chosen) ? [chosen] : []),
  ];
}

function Tabs() {
  const t = useT();
  const { event, plugins, pluginSettings } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["tabs"]),
  );
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "tabs");
  const [selected, setSelected] = useState<string | null>(null);

  const base = useMemo(
    () => eventTabs(event.slug, plugins, pluginSettings, NO_MENUS, t).filter(isArrangeable),
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
  const tab = tabs.find((each) => each.key === selected);

  return (
    <Screen.Section
      id="tabs.items"
      title={t("manageTabs.listTitle")}
      description={t("manageTabs.listHelp")}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={same(items, normalize([]))}
          onClick={() => setItems(normalize([]))}
        >
          <IconArrowBack />
          {t("manageTabs.reset")}
        </Button>
      }
    >
      <EditableList orientation="horizontal" onMove={move}>
        {tabs.map((each, index) => (
          <EditableListItem
            key={each.key}
            id={each.key}
            index={index}
            noun={each.label}
            numbered={false}
            editing={false}
            selected={selected === each.key}
            onEdit={() => setSelected(selected === each.key ? null : each.key)}
            preview={<TabChip tab={each} />}
          />
        ))}
      </EditableList>
      {tab && (
        <Panel
          size="sm"
          title={tab.label}
          description={tabAudience(tab, plugins, t)}
          action={
            <Button
              type="button"
              size="icon-sm"
              aria-label={t("ui.doneEditing", { name: tab.label })}
              tooltip={t("judging.done")}
              onClick={() => setSelected(null)}
            >
              <IconCheck />
            </Button>
          }
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
                <FieldLabel htmlFor={`tab-${tab.key}-window`}>{t("manageTabs.window")}</FieldLabel>
                <OptSelect
                  id={`tab-${tab.key}-window`}
                  className="w-full"
                  value={tab.window ?? ""}
                  options={[
                    { value: "", label: t("manageTabs.always") },
                    ...windowKeys(windows, tab.window).map((key) => ({
                      value: key,
                      label: t("manageTabs.whileOpen", { window: windowLabel({ key }, t) }),
                    })),
                  ]}
                  onChange={(window) => change(tab.key, { window: window || undefined })}
                />
                <FieldDescription>
                  <WindowHelp slug={event.slug} />
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
        </Panel>
      )}
      <ErrorAlert error={save.error} title={t("manageTabs.saveFailed")} />
    </Screen.Section>
  );
}

function WindowHelp({ slug }: { slug: string }) {
  const t = useT();
  return (
    <Linked
      text={t("manageTabs.windowHelp", { agenda: LINK })}
      links={[
        <SettingLink key="agenda" to={`/events/${slug}/manage/agenda`} hash="windows">
          {t("path.agenda")}
        </SettingLink>,
      ]}
    />
  );
}

function tabAudience(tab: ArrangedTab, plugins: Tuple<PluginManifest>, t: T): string | undefined {
  const audience = CORE_TAB_AUDIENCE[tab.key];
  if (audience) return t(audience);
  const plugin = plugins.find(
    (each) => tab.key === `plugin-${each.key}` || tab.key.startsWith(`plugin-${each.key}/`),
  );
  return plugin ? t("manageTabs.fromPlugin", { plugin: plugin.name }) : undefined;
}

function TabChip({ tab }: { tab: ArrangedTab }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={tab.hidden ? "font-medium text-muted-fg line-through" : "font-medium"}>
        {tab.label}
      </span>
      {tab.hidden && (
        <IconEyeOff className="size-4 text-muted-fg" aria-label={t("manageTabs.hidden")} />
      )}
      {tab.window && !tab.hidden && (
        <IconClock
          className="size-4 text-muted-fg"
          aria-label={t("manageTabs.whileOpen", { window: windowLabel({ key: tab.window }, t) })}
        />
      )}
    </span>
  );
}

const ALWAYS = "";

const pageSchema = (t: T) =>
  z.object({
    uid: z.string(),
    id: z.string(),
    title: z
      .string()
      .trim()
      .min(1, t("managePages.nameIt"))
      .max(120, t("form.maxLength", { max: 120 }))
      .meta({ label: t("managePages.pageTitle"), placeholder: t("managePages.titlePlaceholder") }),
    slug: z
      .string()
      .trim()
      .max(64, t("form.maxLength", { max: 64 }))
      .refine((value) => value === "" || SLUG.test(value), t("managePages.badSlug"))
      .meta({ label: t("managePages.slug"), placeholder: t("managePages.slugPlaceholder") })
      .describe(t("managePages.slugHelp")),
    audience: z
      .enum(["members", "public"])
      .meta({ label: t("managePages.audience") })
      .describe(t("managePages.audienceHelp")),
    window: z.string().meta({ label: t("manageTabs.window") }),
    body: z
      .string()
      .max(100_000, t("form.maxLength", { max: 100_000 }))
      .meta({ label: t("managePages.body"), placeholder: t("managePages.bodyPlaceholder") }),
  });
type PageValues = z.infer<ReturnType<typeof pageSchema>>;

const slugOf = (page: Pick<PageValues, "slug" | "title">) =>
  page.slug.trim() || toSlug(page.title.trim()) || "page";

const pagesSchema = (t: T) =>
  z.object({
    items: z
      .array(pageSchema(t))
      .max(50, t("managePages.atMost50"))
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          const slug = slugOf(item);
          if (seen.has(slug)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "slug"],
              message: t("managePages.taken"),
            });
          }
          seen.add(slug);
        });
      }),
  });

const toValues = (page: EventPage): PageValues => ({
  uid: page.id,
  id: page.id,
  title: page.title,
  slug: page.slug,
  audience: page.audience,
  window: page.window_key ?? ALWAYS,
  body: page.body_md,
});

const unfinished = (item: PageValues, schema: ReturnType<typeof pageSchema>) =>
  !schema.safeParse(item).success;

function Pages() {
  const t = useT();
  const schema = useMemo(() => pagesSchema(t), [t]);
  const itemSchema = useMemo(() => pageSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: pages } = useSuspenseQuery(eventPagesQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const [active, setActive] = useState<string | null>(null);

  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: { items: pages.map(toValues) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await savePagesFn({
        data: {
          eventId: event.id,
          pages: value.items.map((item) => ({
            id: item.id,
            slug: slugOf(item),
            title: item.title,
            body_md: item.body,
            window_key: item.window || null,
            audience: item.audience,
          })),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      queryClient.setQueryData(eventPagesQueryOptions(event.id).queryKey, result.data);
      formApi.reset({ items: result.data.map(toValues) });
      setActive(null);
      return undefined;
    },
  });

  return (
    <Screen.Section
      id="pages"
      title={t("managePages.listTitle")}
      description={t("managePages.listHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="items">
            {(list) => (
              <>
                <EditableList
                  onMove={(from, to) => list.moveValue(from, to)}
                  empty={t("managePages.none")}
                >
                  {list.value.map((item, index) => (
                    <EditableListItem
                      key={item.uid}
                      id={item.uid}
                      index={index}
                      noun={t("managePages.noun")}
                      numbered={false}
                      onRemove={() => list.removeValue(index)}
                      confirmRemove={item.id ? t("managePages.removeBody") : undefined}
                      preview={<PagePreview item={item} />}
                      editing={active === item.uid || unfinished(item, itemSchema)}
                      onEdit={() => setActive(item.uid)}
                      onDone={() => setActive(null)}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.Field name={`items[${index}].title`}>
                          {(field) => <field.TextField required />}
                        </form.Field>
                        <form.Field name={`items[${index}].slug`}>
                          {(field) => <field.SlugField />}
                        </form.Field>
                        <form.Field name={`items[${index}].audience`}>
                          {(field) => (
                            <field.Field>
                              <field.Label />
                              <FieldSelect
                                field={field}
                                options={[
                                  { value: "members", label: t("managePages.forMembers") },
                                  { value: "public", label: t("managePages.forPublic") },
                                ]}
                              />
                              <field.Description />
                            </field.Field>
                          )}
                        </form.Field>
                        <form.Field name={`items[${index}].window`}>
                          {(field) => (
                            <field.Field>
                              <field.Label />
                              <FieldSelect
                                field={field}
                                options={[
                                  { value: ALWAYS, label: t("manageTabs.always") },
                                  ...windowKeys(windows, field.value).map((key) => ({
                                    value: key,
                                    label: t("manageTabs.whileOpen", {
                                      window: windowLabel({ key }, t),
                                    }),
                                  })),
                                ]}
                              />
                              <FieldDescription>
                                <WindowHelp slug={event.slug} />
                              </FieldDescription>
                            </field.Field>
                          )}
                        </form.Field>
                      </div>
                      <form.Field name={`items[${index}].body`}>
                        {(field) => <field.MarkdownField rows={10} />}
                      </form.Field>
                    </EditableListItem>
                  ))}
                </EditableList>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({
                        uid,
                        id: "",
                        title: "",
                        slug: "",
                        audience: "members",
                        window: ALWAYS,
                        body: "",
                      });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("managePages.add")}
                  </Button>
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title={t("managePages.saveFailed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

function PagePreview({ item }: { item: PageValues }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium">
        {item.title.trim() || <span className="text-muted-fg">{t("managePages.untitled")}</span>}
      </span>
      <span className="truncate text-xs text-muted-fg">/pages/{slugOf(item)}</span>
      {item.audience === "public" && (
        <Badge variant="secondary">
          <IconWorld />
          {t("managePages.forPublic")}
        </Badge>
      )}
      {item.window && (
        <Badge variant="outline">
          <IconClock />
          {t("manageTabs.whileOpen", { window: windowLabel({ key: item.window }, t) })}
        </Badge>
      )}
    </div>
  );
}
