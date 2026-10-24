import { useMemo, useState } from "react";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  eventDivisionsQueryOptions,
  saveDivisionsFn,
  type Division,
} from "@bogey/db/queries/divisions";
import { eventPeopleQueryOptions } from "@bogey/db/queries/manage";
import {
  rubricDivisionsQueryOptions,
  rubricsQueryOptions,
  setDivisionRubricsFn,
  type Rubric,
  type RubricDivision,
} from "@bogey/db/queries/judging";
import { requestFailure } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { Screen } from "@bogey/ui/components/screen";
import { IconPlus } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { divisionRule } from "#/components/event/team/divisions.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/divisions/")({
  staticData: {
    title: msg("manageNav.divisions"),
    settings: (t) => [
      searchSection(t("manageNav.divisions"), {
        keywords: ["brackets", "tracks"],
        id: "divisions",
      }),
      searchSection(t("manageReg.joining"), { id: "joining" }),
      ...searchSettings("divisions", ["askOnJoin"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({ ...eventDivisionsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventPeopleQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...rubricsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...rubricDivisionsQueryOptions(context.event.id),
        staleTime: "static",
      }),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "divisions",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const divisionSchema = (t: T) =>
  z.object({
    uid: z.string(),
    id: z.string(),
    name: z
      .string()
      .trim()
      .min(1, t("manageDivisions.nameIt"))
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("checkin.name"), placeholder: t("manageDivisions.namePlaceholder") }),
    description: z
      .string()
      .trim()
      .max(300, t("form.maxLength", { max: 300 }))
      .meta({
        label: t("homeEditor.description"),
        placeholder: t("manageDivisions.descriptionPlaceholder"),
      }),
    selectable: z
      .boolean()
      .meta({ label: t("manageDivisions.selectable") })
      .describe(t("manageDivisions.selectableHelp")),
    switchable: z
      .boolean()
      .meta({ label: t("manageDivisions.switchable") })
      .describe(t("manageDivisions.switchableHelp")),
    rubricIds: z
      .array(z.string())
      .meta({
        label: t("manageDivisions.rubrics"),
        placeholder: t("manageDivisions.rubricsPlaceholder"),
      })
      .describe(t("manageDivisions.rubricsHelp")),
  });
type DivisionValues = z.infer<ReturnType<typeof divisionSchema>>;

const divisionsSchema = (t: T) =>
  z.object({
    items: z
      .array(divisionSchema(t))
      .max(50, t("manageDivisions.atMost50"))
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          const key = item.name.trim().toLowerCase();
          if (key && seen.has(key)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "name"],
              message: t("manageDivisions.exists"),
            });
          }
          seen.add(key);
        });
      }),
  });

const toValues = (division: Division, links: Tuple<RubricDivision>): DivisionValues => ({
  uid: division.id,
  id: division.id,
  name: division.name,
  description: division.description ?? "",
  selectable: division.selectable,
  switchable: division.switchable,
  rubricIds: links.filter((link) => link.divisionId === division.id).map((link) => link.rubricId),
});

const unfinished = (item: DivisionValues, schema: ReturnType<typeof divisionSchema>) =>
  !schema.safeParse(item).success;

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => divisionsSchema(t), [t]);
  const itemSchema = useMemo(() => divisionSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const { data: people } = useSuspenseQuery(eventPeopleQueryOptions(event.id));
  const { data: rubrics } = useSuspenseQuery(rubricsQueryOptions(event.id));
  const { data: links } = useSuspenseQuery(rubricDivisionsQueryOptions(event.id));
  const rubricOptions = rubrics.map((rubric) => ({ value: rubric.id, label: rubric.name }));
  const [active, setActive] = useState<string | null>(null);
  const scope = { scope: "event", eventId: event.id } as const;
  const count = (id: string) => people.members.filter((member) => member.divisionId === id).length;

  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: { items: divisions.map((division) => toValues(division, links)) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await saveDivisionsFn({
        data: {
          eventId: event.id,
          divisions: value.items.map(({ uid: _uid, rubricIds: _rubrics, ...item }) => item),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      queryClient.setQueryData(eventDivisionsQueryOptions(event.id).queryKey, result.data);
      // new divisions get their ids on save, so their rubrics follow by name
      const savedId = (item: DivisionValues) =>
        item.id ||
        result.data.find(
          (division) => division.name.toLowerCase() === item.name.trim().toLowerCase(),
        )?.id;
      const assigned =
        rubrics.length > 0
          ? await setDivisionRubricsFn({
              data: {
                eventId: event.id,
                items: value.items.flatMap((item) => {
                  const divisionId = savedId(item);
                  return divisionId ? [{ divisionId, rubricIds: item.rubricIds }] : [];
                }),
              },
            }).catch(requestFailure)
          : null;
      await queryClient.invalidateQueries({ queryKey: ["divisions", event.id] });
      const savedLinks = await queryClient.query({
        ...rubricDivisionsQueryOptions(event.id),
        staleTime: 0,
      });
      formApi.reset({ items: result.data.map((division) => toValues(division, savedLinks)) });
      if (assigned && !assigned.ok) return createValidationError(assigned.error.message);
      setActive(null);
      return undefined;
    },
  });

  return (
    <Screen
      title={t("manageNav.divisions")}
      description={t("manageDivisions.intro")}
      width="embedded"
    >
      <Screen.Section
        id="divisions"
        title={t("manageNav.divisions")}
        description={t("manageDivisions.order")}
      >
        <form.AppForm>
          <form.Form unsaved="save" className="flex flex-col gap-3">
            <form.Field name="items">
              {(list) => (
                <>
                  <EditableList
                    onMove={(from, to) => list.moveValue(from, to)}
                    empty={t("manageDivisions.none")}
                  >
                    {list.value.map((item, index) => {
                      const members = item.id ? count(item.id) : 0;
                      return (
                        <EditableListItem
                          key={item.uid}
                          id={item.uid}
                          index={index}
                          noun={t("manageDivisions.noun")}
                          numbered={false}
                          onRemove={() => list.removeValue(index)}
                          confirmRemove={
                            members > 0 ? t("manageDivisions.inUse", { count: members }) : undefined
                          }
                          preview={
                            <DivisionPreview item={item} members={members} rubrics={rubrics} />
                          }
                          editing={active === item.uid || unfinished(item, itemSchema)}
                          onEdit={() => setActive(item.uid)}
                          onDone={() => setActive(null)}
                        >
                          <form.Field name={`items[${index}].name`}>
                            {(field) => <field.TextField required />}
                          </form.Field>
                          <form.Field name={`items[${index}].description`}>
                            {(field) => <field.TextField />}
                          </form.Field>
                          <form.Field name={`items[${index}].selectable`}>
                            {(field) => <field.SwitchField />}
                          </form.Field>
                          <form.Field name={`items[${index}].switchable`}>
                            {(field) => <field.SwitchField />}
                          </form.Field>
                          {rubrics.length > 0 && (
                            <form.Field name={`items[${index}].rubricIds`}>
                              {(field) => <field.MultiSelectField options={rubricOptions} />}
                            </form.Field>
                          )}
                        </EditableListItem>
                      );
                    })}
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
                          name: "",
                          description: "",
                          selectable: true,
                          switchable: true,
                          rubricIds: [],
                        });
                        setActive(uid);
                      }}
                    >
                      <IconPlus />
                      {t("manageDivisions.add")}
                    </Button>
                  </div>
                </>
              )}
            </form.Field>
            <form.FormAlert title={t("manageDivisions.saveFailed")} />
          </form.Form>
        </form.AppForm>
      </Screen.Section>

      <Screen.Section id="joining" title={t("manageReg.joining")}>
        <SettingFields scope={scope} namespace="divisions" keys={["askOnJoin"]} />
      </Screen.Section>
      <PluginSettingSections page="divisions" />
    </Screen>
  );
}

function DivisionPreview({
  item,
  members,
  rubrics,
}: {
  item: DivisionValues;
  members: number;
  rubrics: Tuple<Rubric>;
}) {
  const t = useT();
  const judgedOn = rubrics.filter((rubric) => item.rubricIds.includes(rubric.id));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {item.name.trim() || <span className="text-muted-fg">{t("division.untitled")}</span>}
        </span>
        {item.id && <Badge variant="secondary">{t("division.people", { count: members })}</Badge>}
      </div>
      {item.description.trim() && (
        <p className="text-sm text-muted-fg">{item.description.trim()}</p>
      )}
      <p className="text-xs text-muted-fg">{divisionRule(item, t)}</p>
      {judgedOn.length > 0 && (
        <p className="text-xs text-muted-fg">
          {t("manageDivisions.judgedOn", {
            names: judgedOn.map((rubric) => rubric.name).join(", "),
          })}
        </p>
      )}
    </div>
  );
}
