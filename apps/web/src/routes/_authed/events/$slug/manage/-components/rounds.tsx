import { useMemo, useState } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  advanceSubmissionsFn,
  assignJudgesFn,
  judgingRoundsQueryOptions,
  judgingProgressQueryOptions,
  ROUND_FORMATS,
  saveRoundFn,
  type JudgingRound,
} from "@bogey/db/queries/judging";
import { Link } from "@tanstack/react-router";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { requestFailure } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { pluginRankingMethods, type PluginManifest } from "@bogey/plugins";
import { windowLabel } from "#/lib/windows.ts";
import { useT, type T } from "#/lib/translate.tsx";

const EVENT_WINDOW = "judging";

const FORMAT_LABEL = {
  online: (t: T) => t("rounds.online"),
  demos: (t: T) => t("rounds.demos"),
  offline: (t: T) => t("rounds.offline"),
} as const;
const RUBRIC = "rubric";

const roundSchema = (t: T) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("rounds.nameIt"))
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("checkin.name") }),
    windowKey: z
      .string()
      .min(1)
      .meta({ label: t("rounds.duringLabel") }),
    method: z
      .string()
      .min(1)
      .meta({ label: t("rounds.rankedBy") }),
    format: z.enum(ROUND_FORMATS).meta({ label: t("rounds.format") }),
  });

const assignSchema = (t: T) =>
  z.object({
    per: z
      .number(t("orgLimit.enterNumber"))
      .int(t("eventForm.whole"))
      .min(1, t("eventForm.atLeast", { min: 1 }))
      .max(20, t("eventForm.atMost", { max: 20 }))
      .meta({ label: t("manageJudging.perProject") }),
  });

const advanceSchema = (t: T) =>
  z.object({
    top: z
      .number(t("orgLimit.enterNumber"))
      .int(t("eventForm.whole"))
      .min(1, t("eventForm.atLeast", { min: 1 }))
      .max(500, t("eventForm.atMost", { max: 500 }))
      .meta({ label: t("rounds.advanceTop") }),
  });

function RoundRow({
  eventId,
  slug,
  round,
  entries,
  last,
  plugins,
}: {
  eventId: string;
  slug: string;
  round: JudgingRound;
  plugins: Tuple<PluginManifest>;
  entries: number | null;
  last: boolean;
}) {
  const t = useT();
  const roundForm = useMemo(() => roundSchema(t), [t]);
  const assignForm = useMemo(() => assignSchema(t), [t]);
  const advanceForm = useMemo(() => advanceSchema(t), [t]);
  const queryClient = useQueryClient();
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(eventId));
  const methods = pluginRankingMethods(plugins);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: judgingRoundsQueryOptions(eventId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: judgingProgressQueryOptions(eventId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: ["results-preview", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["judge-queue", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["demo-panels", eventId] }),
    ]);
  };
  const settings = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        name: round.name,
        windowKey: round.windowKey ?? EVENT_WINDOW,
        method: round.method,
        format: round.format,
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(roundForm)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await saveRoundFn({
        data: {
          roundId: round.id,
          name: value.name,
          windowKey: value.windowKey === EVENT_WINDOW ? "" : value.windowKey,
          method: value.method,
          format: value.format,
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setNotice(t("rounds.saved"));
      await refresh();
      return undefined;
    },
  });
  const assignment = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { per: 2 },
      errorVisibility,
      validators: [rewardEarlyPunishLate(assignForm)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await assignJudgesFn({
        data: { eventId, perSubmission: value.per, roundId: round.id },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setNotice(t("manageJudging.newAssignments", { count: result.data }));
      await refresh();
      return undefined;
    },
  });
  const advancing = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { top: 5 },
      errorVisibility,
      validators: [rewardEarlyPunishLate(advanceForm)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await advanceSubmissionsFn({
        data: { roundId: round.id, top: value.top },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setNotice(t("rounds.advanced", { top: value.top }));
      await refresh();
      return undefined;
    },
  });

  return (
    <DisclosureRow
      title={round.name}
      meta={`${entries === null ? t("rounds.everyProject") : t("rounds.entries", { count: entries })} · ${FORMAT_LABEL[round.format](t)}`}
    >
      <div className="flex flex-col gap-4">
        <settings.AppForm>
          <settings.Form unsaved="save" className="flex flex-wrap items-end gap-3">
            <settings.Field name="name">
              {(field) => (
                <field.Field className="w-56">
                  <field.Label />
                  <field.TextInput maxLength={60} />
                  <field.Error />
                </field.Field>
              )}
            </settings.Field>
            <settings.Field name="format">
              {(field) => (
                <field.Field className="w-64">
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={[
                      {
                        value: "online",
                        label: t("rounds.online"),
                        description: t("rounds.onlineHelp"),
                      },
                      {
                        value: "demos",
                        label: t("rounds.demos"),
                        description: t("rounds.demosHelp"),
                      },
                      {
                        value: "offline",
                        label: t("rounds.offline"),
                        description: t("rounds.offlineHelp"),
                      },
                    ]}
                  />
                </field.Field>
              )}
            </settings.Field>
            <settings.Field name="windowKey">
              {(field) => (
                <field.Field className="w-56">
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={[
                      { value: EVENT_WINDOW, label: t("rounds.eventJudging") },
                      ...windows
                        .filter((window) => window.key !== EVENT_WINDOW)
                        .map((window) => ({ value: window.key, label: windowLabel(window, t) })),
                    ]}
                  />
                </field.Field>
              )}
            </settings.Field>
            {methods.length > 0 && round.format !== "offline" && (
              <settings.Field name="method">
                {(field) => (
                  <field.Field className="w-64">
                    <field.Label />
                    <FieldSelect
                      field={field}
                      options={[
                        {
                          value: RUBRIC,
                          label: t("rounds.rubric"),
                          description: t("rounds.rubricHelp"),
                        },
                        ...methods.map((each) => ({
                          value: each.id,
                          label: each.label,
                          description: each.description,
                        })),
                        ...(field.value !== RUBRIC &&
                        !methods.some((each) => each.id === field.value)
                          ? [
                              {
                                value: field.value,
                                label: field.value,
                                description: t("rounds.pluginOff"),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </field.Field>
                )}
              </settings.Field>
            )}
            <settings.FormAlert title={t("rounds.saveFailed")} />
          </settings.Form>
        </settings.AppForm>
        {round.format === "demos" && (
          <p className="text-sm text-muted-fg">
            {t("rounds.demosNext")}{" "}
            <Link to="/events/$slug/manage/demos" params={{ slug }}>
              {t("rounds.openDemos")}
            </Link>
          </p>
        )}
        {round.format === "offline" && (
          <p className="text-sm text-muted-fg">
            {t("rounds.offlineNext")}{" "}
            <Link to="/events/$slug/manage/results" hash="offline-scores" params={{ slug }}>
              {t("rounds.openOffline")}
            </Link>
          </p>
        )}
        {round.format === "online" && (
          <assignment.AppForm>
            <assignment.Form className="flex flex-wrap items-end gap-3">
              <assignment.Field name="per">
                {(field) => (
                  <field.Field orientation="inline">
                    <field.Label />
                    <field.NumberInput min={1} max={20} />
                    <field.Error />
                  </field.Field>
                )}
              </assignment.Field>
              <assignment.Submit size="sm" variant="outline" pending={t("manageJudging.assigning")}>
                {t("manageJudging.assign")}
              </assignment.Submit>
              <assignment.FormAlert title={t("manageJudging.assignFailed")} />
            </assignment.Form>
          </assignment.AppForm>
        )}
        <advancing.AppForm>
          <advancing.Form className="flex flex-wrap items-end gap-3">
            <advancing.Field name="top">
              {(field) => (
                <field.Field orientation="inline">
                  <field.Label />
                  <field.NumberInput min={1} max={500} />
                  <field.Error />
                </field.Field>
              )}
            </advancing.Field>
            <advancing.Subscribe
              selector={(state) => ({ top: state.values.top, busy: state.isSubmitting })}
            >
              {({ top, busy }) => (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  confirm={{
                    title: t("rounds.advanceTitle", { top }),
                    description: last ? t("rounds.advanceNew") : t("rounds.advanceNext"),
                    label: t("rounds.advance"),
                  }}
                  onClick={() => void advancing.handleSubmit()}
                >
                  {busy ? t("rounds.advancing") : t("rounds.advanceButton")}
                </Button>
              )}
            </advancing.Subscribe>
            <advancing.FormAlert title={t("rounds.advanceFailed")} />
          </advancing.Form>
        </advancing.AppForm>
        {notice && (
          <p role="status" className="text-sm text-muted-fg">
            {notice}
          </p>
        )}
      </div>
    </DisclosureRow>
  );
}

export function Rounds({
  eventId,
  slug,
  plugins,
}: {
  eventId: string;
  slug: string;
  plugins: Tuple<PluginManifest>;
}) {
  const t = useT();
  const { data } = useSuspenseQuery(judgingRoundsQueryOptions(eventId));
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(eventId));
  const judged = forms.filter((form) => form.judged);
  const several = data.rounds.filter((round) => round.ordinal > 1).length > 0;

  return (
    <Screen.Section id="rounds" title={t("manageJudging.rounds")} description={t("rounds.intro")}>
      {judged.map((form) => {
        const rounds = data.rounds.filter((round) => round.formId === form.id);
        return (
          <div key={form.id} className="flex flex-col gap-1">
            {(judged.length > 1 || several) && (
              <h3 className="text-sm font-medium">{form.title}</h3>
            )}
            <DisclosureList>
              {rounds.map((round, index) => (
                <RoundRow
                  key={round.id}
                  eventId={eventId}
                  slug={slug}
                  round={round}
                  entries={
                    round.ordinal === 1
                      ? null
                      : data.entries.filter((entry) => entry.roundId === round.id).length
                  }
                  last={index === rounds.length - 1}
                  plugins={plugins}
                />
              ))}
            </DisclosureList>
          </div>
        );
      })}
    </Screen.Section>
  );
}
