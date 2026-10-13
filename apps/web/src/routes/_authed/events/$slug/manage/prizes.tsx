import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconPlus } from "@tabler/icons-react";
import {
  eventPrizesQueryOptions,
  savePrizesFn,
  type Prize,
  type PrizeDraft,
} from "@bogey/db/queries/prizes";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { requestFailure } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { ImageInput } from "#/components/event/submission/image-input.tsx";
import { PrizeCard } from "#/components/event/judging/prize-card.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/prizes")({
  staticData: {
    title: msg("prizes.title"),
    settings: (t) => [
      searchSection(t("prizes.title"), { keywords: ["tracks", "sponsors"], id: "prizes" }),
      searchSection(t("managePrizes.entering"), { id: "entering-prizes" }),
      ...searchSettings("submissions", ["maxTracks"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventPrizesQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "submissions",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const EVERY_FORM = "every-form";

const prizeSchema = (t: T) =>
  z.object({
    uid: z.string(),
    id: z.string(),
    name: z
      .string()
      .trim()
      .min(1, t("managePrizes.nameIt"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("checkin.name"), placeholder: t("managePrizes.namePlaceholder") }),
    description: z
      .string()
      .max(5000, t("form.maxLength", { max: 5000 }))
      .meta({
        label: t("managePrizes.description"),
        placeholder: t("managePrizes.descriptionPlaceholder"),
      }),
    prize: z
      .string()
      .max(2000, t("form.maxLength", { max: 2000 }))
      .meta({
        label: t("managePrizes.winnersGet"),
        placeholder: t("managePrizes.winnersPlaceholder"),
      }),
    sponsorName: z
      .string()
      .trim()
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("managePrizes.sponsor"), placeholder: t("managePrizes.optional") }),
    sponsorLogoUrl: z
      .string()
      .trim()
      .max(500)
      .meta({ label: t("managePrizes.sponsorLogo") }),
    maxWinners: z
      .number()
      .int(t("eventForm.whole"))
      .min(1, t("eventForm.atLeast", { min: 1 }))
      .max(20, t("eventForm.atMost", { max: 20 }))
      .meta({ label: t("managePrizes.winners") }),
    optIn: z
      .boolean()
      .meta({ label: t("managePrizes.optIn") })
      .describe(t("managePrizes.optInHelp")),
    formId: z.string().meta({ label: t("managePrizes.appliesTo") }),
  });

const schemaFor = (t: T) =>
  z.object({
    prizes: z
      .array(prizeSchema(t))
      .max(40, t("managePrizes.atMost40"))
      .superRefine((prizes, context) => {
        const seen = new Set<string>();
        prizes.forEach((prize, index) => {
          const name = prize.name.trim().toLowerCase();
          if (name && seen.has(name)) {
            context.addIssue({
              code: "custom",
              path: [index, "name"],
              message: t("managePrizes.alreadyUsed"),
            });
          }
          seen.add(name);
          if (prize.sponsorLogoUrl && !/^https?:\/\//.test(prize.sponsorLogoUrl)) {
            context.addIssue({
              code: "custom",
              path: [index, "sponsorLogoUrl"],
              message: t("managePrizes.fullAddress"),
            });
          }
        });
      }),
  });

type Draft = z.infer<ReturnType<typeof prizeSchema>>;

function toDraft(prize: Prize): Draft {
  return {
    uid: prize.id,
    id: prize.id,
    name: prize.name,
    description: prize.description,
    prize: prize.prize,
    sponsorName: prize.sponsorName ?? "",
    sponsorLogoUrl: prize.sponsorLogoUrl ?? "",
    maxWinners: prize.maxWinners,
    optIn: prize.optIn,
    formId: prize.formId ?? EVERY_FORM,
  };
}

function toPrize(draft: Draft): PrizeDraft {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    description: draft.description,
    prize: draft.prize,
    sponsorName: draft.sponsorName.trim() || null,
    sponsorLogoUrl: draft.sponsorLogoUrl.trim() || null,
    maxWinners: draft.maxWinners,
    optIn: draft.optIn,
    formId: draft.formId === EVERY_FORM ? null : draft.formId,
  };
}

const BLANK: Omit<Draft, "uid"> = {
  id: "",
  name: "",
  description: "",
  prize: "",
  sponsorName: "",
  sponsorLogoUrl: "",
  maxWinners: 1,
  optIn: true,
  formId: EVERY_FORM,
};

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => schemaFor(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: prizes } = useSuspenseQuery(eventPrizesQueryOptions(event.id));
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  const scope = { scope: "event", eventId: event.id } as const;
  const [active, setActive] = useState<string | null>(null);
  const formOptions: Tuple<{ value: string; label: string }> = [
    { value: EVERY_FORM, label: t("managePrizes.everyForm") },
    ...forms.map((item) => ({ value: item.id, label: item.title })),
  ];

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { prizes: prizes.map(toDraft) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await savePrizesFn({
        data: { eventId: event.id, prizes: value.prizes.map(toPrize) },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      await queryClient.invalidateQueries({ queryKey: eventPrizesQueryOptions(event.id).queryKey });
      const saved = await queryClient.fetchQuery({
        ...eventPrizesQueryOptions(event.id),
        staleTime: 0,
      });
      form.reset({ prizes: saved.map(toDraft) });
      return undefined;
    },
  });

  return (
    <Screen title={t("prizes.title")} description={t("managePrizes.intro")} width="embedded">
      <Screen.Section id="prizes" title={t("prizes.title")}>
        <form.AppForm>
          <form.Form unsaved="save">
            <form.Field name="prizes">
              {(list) => (
                <div className="flex flex-col gap-4">
                  {list.value.length === 0 && (
                    <p className="text-sm text-muted-fg">{t("managePrizes.none")}</p>
                  )}
                  <EditableList onMove={(from, to) => list.moveValue(from, to)}>
                    {list.value.map((prize, index) => (
                      <EditableListItem
                        key={prize.uid}
                        id={prize.uid}
                        index={index}
                        noun={t("managePrizes.noun")}
                        onRemove={() => list.removeValue(index)}
                        preview={<PrizeCard prize={toPrize(prize)} />}
                        editing={active === prize.uid || !prize.name.trim()}
                        onEdit={() => setActive(prize.uid)}
                        onDone={() => setActive(null)}
                      >
                        <form.Field name={`prizes[${index}].name`}>
                          {(field) => <field.TextField required />}
                        </form.Field>
                        <form.Field name={`prizes[${index}].description`}>
                          {(field) => <field.MarkdownField rows={3} preview={false} />}
                        </form.Field>
                        <form.Field name={`prizes[${index}].prize`}>
                          {(field) => <field.MarkdownField rows={2} preview={false} />}
                        </form.Field>
                        <form.Field name={`prizes[${index}].sponsorName`}>
                          {(field) => <field.TextField />}
                        </form.Field>
                        <form.Field name={`prizes[${index}].sponsorLogoUrl`}>
                          {(field) => (
                            <field.Field>
                              <field.Label />
                              <ImageInput
                                id={field.name}
                                eventId={event.id}
                                value={field.value}
                                onChange={(url) => field.handleChange(url)}
                                invalid={field.meta.isInvalid}
                                compact
                              />
                              <field.Error />
                            </field.Field>
                          )}
                        </form.Field>
                        <form.Field name={`prizes[${index}].maxWinners`}>
                          {(field) => <field.NumberField min={1} max={20} />}
                        </form.Field>
                        <form.Field name={`prizes[${index}].optIn`}>
                          {(field) => <field.SwitchField />}
                        </form.Field>
                        <form.Field name={`prizes[${index}].formId`}>
                          {(field) => (
                            <field.Field>
                              <field.Label />
                              <FieldSelect field={field} options={formOptions} />
                            </field.Field>
                          )}
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
                        list.pushValue({ ...BLANK, uid });
                        setActive(uid);
                      }}
                    >
                      <IconPlus />
                      {t("managePrizes.add")}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-fg">
                    {t("managePrizes.count", { count: list.value.length })}
                  </p>
                  <form.FormAlert title={t("prizes.saveFailed")} />
                </div>
              )}
            </form.Field>
          </form.Form>
        </form.AppForm>
      </Screen.Section>
      <Screen.Section id="entering-prizes" title={t("managePrizes.entering")}>
        <SettingFields scope={scope} namespace="submissions" keys={["maxTracks"]} />
      </Screen.Section>
      <PluginSettingSections page="prizes" />
    </Screen>
  );
}
