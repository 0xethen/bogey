import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  IconArrowDown,
  IconArrowUp,
  IconPlayerPlay,
  IconPlus,
  IconPresentation,
} from "@tabler/icons-react";
import { activeRound } from "@bogey/utils/rounds";
import { isoToWallTime, wallTimeToIso, formatTime } from "@bogey/utils/time";
import {
  judgingProgressQueryOptions,
  judgingRoundsQueryOptions,
  type JudgingRound,
} from "@bogey/db/queries/judging";
import {
  demoPanelsQueryOptions,
  moveDemoFn,
  savePanelsFn,
  scheduleDemosFn,
  setPanelNowFn,
  type DemoPanel,
} from "@bogey/db/queries/demos";
import {
  eventSubmissionsQueryOptions,
  submissionFormsQueryOptions,
} from "@bogey/db/queries/submissions";
import { tableListQueryOptions } from "@bogey/db/queries/expo";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { useViewerTimeFormat } from "#/lib/time.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { Tables } from "../-components/tables.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging/demos")({
  staticData: {
    title: msg("manageNav.demos"),
    settings: (t) => [
      searchSection(t("demos.panels"), {
        keywords: ["live demos", "presentations", "pitch", "rooms", "judge groups", "schedule"],
        id: "panels",
      }),
      searchSection(t("demos.teamsSee"), { id: "what-teams-see" }),
      ...searchSettings("judging", ["demoJudges"], t),
      searchSection(t("tablesEditor.title"), { keywords: ["tables", "booths"], id: "expo-tables" }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(demoPanelsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingProgressQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventSubmissionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(tableListQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "judging",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: rounds } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  useLiveInvalidate("judging_panels", demoPanelsQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });
  const demoRounds = rounds.rounds.filter((round) => round.format === "demos");
  const label = (round: JudgingRound) => {
    const form = forms.find((each) => each.id === round.formId)?.title;
    return demoRounds.length > 1 && form ? `${form}: ${round.name}` : round.name;
  };

  return (
    <Screen title={t("manageNav.demos")} description={t("demos.intro")} width="embedded">
      {demoRounds.length === 0 ? (
        <Screen.Section id="panels" title={t("demos.panels")}>
          <p className="text-sm text-muted-fg">
            {t("demos.noRounds")}{" "}
            <Link
              to="/events/$slug/manage/judging"
              hash="rounds"
              params={{ slug: event.slug }}
              className="link"
            >
              {t("demos.toRounds")}
            </Link>
          </p>
        </Screen.Section>
      ) : (
        demoRounds.map((round) => <DemoRound key={round.id} round={round} title={label(round)} />)
      )}
      {demoRounds.length > 0 && (
        <Screen.Section id="what-teams-see" title={t("demos.teamsSee")}>
          <SettingFields
            scope={{ scope: "event", eventId: event.id }}
            namespace="judging"
            keys={["demoJudges"]}
          />
        </Screen.Section>
      )}
      <Tables eventId={event.id} slug={event.slug} />
    </Screen>
  );
}

const panelSchema = (t: T) =>
  z.object({
    panels: z
      .array(
        z.object({
          uid: z.string(),
          id: z.string(),
          name: z
            .string()
            .trim()
            .min(1, t("demos.nameIt"))
            .max(60, t("form.maxLength", { max: 60 }))
            .meta({ label: t("checkin.name"), placeholder: t("demos.namePlaceholder") }),
          location: z
            .string()
            .max(120, t("form.maxLength", { max: 120 }))
            .meta({ label: t("demos.location"), placeholder: t("demos.locationPlaceholder") }),
          startsAt: z.string().meta({ label: t("demos.startsAt") }),
          slotMinutes: z
            .number(t("orgLimit.enterNumber"))
            .int(t("eventForm.whole"))
            .min(1, t("eventForm.atLeast", { min: 1 }))
            .max(240, t("eventForm.atMost", { max: 240 }))
            .meta({ label: t("demos.slotMinutes") }),
          judges: z.array(z.string()).meta({ label: t("demos.judges") }),
        }),
      )
      .max(50),
  });

type PanelValues = z.infer<ReturnType<typeof panelSchema>>["panels"][number];

function DemoRound({ round, title }: { round: JudgingRound; title: string }) {
  const t = useT();
  const schema = useMemo(() => panelSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const time = useViewerTimeFormat();
  const eventTime = { ...time, timeZone: event.timezone };
  const { data: allPanels } = useSuspenseQuery(demoPanelsQueryOptions(event.id));
  const { data: progress } = useSuspenseQuery(judgingProgressQueryOptions(event.id));
  const { data: rounds } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const { data: submissions } = useSuspenseQuery(eventSubmissionsQueryOptions(event.id));
  const panels = allPanels.filter((panel) => panel.roundId === round.id);
  const [active, setActive] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: demoPanelsQueryOptions(event.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: judgingProgressQueryOptions(event.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: ["judge-queue", event.id] }),
    ]);
  const toValues = (panel: DemoPanel): PanelValues => ({
    uid: panel.id,
    id: panel.id,
    name: panel.name,
    location: panel.location,
    startsAt: isoToWallTime(panel.startsAt, event.timezone),
    slotMinutes: panel.slotMinutes,
    judges: panel.judges.map((judge) => judge.id),
  });

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { panels: panels.map(toValues) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await savePanelsFn({
        data: {
          roundId: round.id,
          panels: value.panels.map((panel) => ({
            id: panel.id || undefined,
            name: panel.name.trim(),
            location: panel.location.trim(),
            startsAt: panel.startsAt ? wallTimeToIso(panel.startsAt, event.timezone) : null,
            slotMinutes: panel.slotMinutes,
            judges: panel.judges,
          })),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      await refresh();
      const saved = await queryClient.fetchQuery({
        ...demoPanelsQueryOptions(event.id),
        staleTime: 0,
      });
      formApi.reset({
        panels: saved.filter((panel) => panel.roundId === round.id).map(toValues),
      });
      return undefined;
    },
  });

  const schedule = useMutation({
    mutationFn: async (reset: boolean) =>
      unwrap(await scheduleDemosFn({ data: { roundId: round.id, reset } })),
    onSuccess: (placed) => setNotice(t("demos.scheduled", { count: placed })),
    onSettled: refresh,
  });
  const move = useMutation({
    mutationFn: async (input: { submissionId: string; panelId: string; position?: number }) =>
      unwrap(await moveDemoFn({ data: { roundId: round.id, ...input } })),
    onSettled: refresh,
  });
  const setNow = useMutation({
    mutationFn: async (input: { panelId: string; position: number | null }) =>
      unwrap(await setPanelNowFn({ data: input })),
    onSettled: refresh,
  });

  const slotted = new Set(panels.flatMap((panel) => panel.slots.map((slot) => slot.submissionId)));
  const waiting = submissions.filter((submission) => {
    if (submission.status !== "submitted" || slotted.has(submission.id)) return false;
    const current = activeRound(rounds.rounds, rounds.entries, {
      id: submission.id,
      formId: submission.form_id,
    });
    return current?.id === round.id;
  });
  const judgeOptions = progress.judges.map((judge) => ({ value: judge.userId, label: judge.name }));
  const busy = schedule.isPending || move.isPending || setNow.isPending;

  return (
    <Screen.Section
      id={`panels-${round.id}`}
      title={t("demos.roundTitle", { round: title })}
      description={t("demos.panelsHelp")}
      actions={
        panels.length > 0 && (
          <>
            <Button
              size="sm"
              disabled={busy || waiting.length === 0}
              tooltip={waiting.length === 0 ? t("demos.nothingWaiting") : undefined}
              onClick={() => schedule.mutate(false)}
            >
              {t("demos.schedule", { count: waiting.length })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || slotted.size === 0}
              tooltip={slotted.size === 0 ? t("demos.nothingSlotted") : undefined}
              confirm={{
                title: t("demos.reshuffleTitle"),
                description: t("demos.reshuffleBody"),
                label: t("demos.reshuffle"),
              }}
              onClick={() => schedule.mutate(true)}
            >
              {t("demos.reshuffleButton")}...
            </Button>
          </>
        )
      }
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="panels">
            {(list) => (
              <>
                <EditableList
                  onMove={(from, to) => list.moveValue(from, to)}
                  empty={t("demos.noPanels")}
                >
                  {list.value.map((panel, index) => (
                    <EditableListItem
                      key={panel.uid}
                      id={panel.uid}
                      index={index}
                      noun={t("demos.panelNoun")}
                      onRemove={() => list.removeValue(index)}
                      confirmRemove={panel.id ? t("demos.removeWarning") : undefined}
                      preview={
                        <div className="flex flex-col gap-0.5">
                          <p className="font-medium">
                            {panel.name.trim() || t("demos.numbered", { n: index + 1 })}
                            {panel.location.trim() && (
                              <span className="font-normal text-muted-fg">
                                {" "}
                                · {panel.location.trim()}
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-muted-fg">
                            {[
                              panel.judges.length === 0
                                ? t("demos.noJudges")
                                : panel.judges
                                    .map(
                                      (id) =>
                                        judgeOptions.find((judge) => judge.value === id)?.label ??
                                        t("fairness.judge"),
                                    )
                                    .join(", "),
                              t("demos.minutesEach", { count: panel.slotMinutes }),
                            ].join(" · ")}
                          </p>
                        </div>
                      }
                      editing={active === panel.uid || !panel.name.trim()}
                      onEdit={() => setActive(panel.uid)}
                      onDone={() => setActive(null)}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <form.Field name={`panels[${index}].name`}>
                          {(field) => <field.TextField required />}
                        </form.Field>
                        <form.Field name={`panels[${index}].location`}>
                          {(field) => <field.TextField />}
                        </form.Field>
                        <form.Field name={`panels[${index}].startsAt`}>
                          {(field) => <field.DateTimeField description={t("demos.startsHelp")} />}
                        </form.Field>
                        <form.Field name={`panels[${index}].slotMinutes`}>
                          {(field) => (
                            <field.Field>
                              <field.Label />
                              <field.NumberInput min={1} max={240} />
                              <field.Error />
                            </field.Field>
                          )}
                        </form.Field>
                      </div>
                      <form.Field name={`panels[${index}].judges`}>
                        {(field) => (
                          <field.MultiSelectField
                            options={judgeOptions}
                            description={t("demos.judgesHelp")}
                          />
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
                      const previous = list.value.at(-1);
                      list.pushValue({
                        uid,
                        id: "",
                        name: "",
                        location: "",
                        startsAt: previous?.startsAt ?? "",
                        slotMinutes: previous?.slotMinutes ?? 8,
                        judges: [],
                      });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("demos.addPanel")}
                  </Button>
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title={t("demos.saveFailed")} />
        </form.Form>
      </form.AppForm>

      {notice && (
        <p role="status" className="text-sm text-muted-fg">
          {notice}
        </p>
      )}
      <ErrorAlert
        error={schedule.error ?? move.error ?? setNow.error}
        title={t("demos.changeFailed")}
      />

      {panels.map((panel) => (
        <div key={panel.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">
              {panel.name}
              {panel.location && (
                <span className="font-normal text-muted-fg"> · {panel.location}</span>
              )}
            </h4>
            {panel.slots.length > 0 && (
              <span className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  tooltip={t("present.openHelp")}
                  render={
                    <Link
                      to="/events/$slug/demos/$panelId"
                      params={{ slug: event.slug, panelId: panel.id }}
                    />
                  }
                  nativeButton={false}
                >
                  <IconPresentation />
                  {t("present.open")}
                </Button>
                {panel.nowPosition !== null && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setNow.mutate({ panelId: panel.id, position: null })}
                  >
                    {t("demos.resetNow")}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || (panel.nowPosition ?? -1) >= panel.slots.length}
                  onClick={() =>
                    setNow.mutate({
                      panelId: panel.id,
                      position: panel.nowPosition === null ? 0 : panel.nowPosition + 1,
                    })
                  }
                >
                  <IconPlayerPlay />
                  {panel.nowPosition === null ? t("demos.start") : t("demos.next")}
                </Button>
              </span>
            )}
          </div>
          {panel.slots.length === 0 ? (
            <p className="text-sm text-muted-fg">{t("demos.emptyPanel")}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-2xl border border-border">
              {panel.slots.map((slot, index) => (
                <li
                  key={slot.submissionId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  aria-current={panel.nowPosition === slot.position ? "step" : undefined}
                >
                  <span className="w-16 shrink-0 text-sm text-muted-fg tabular-nums">
                    {slot.startsAt ? formatTime(slot.startsAt, eventTime) : `#${slot.position + 1}`}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {slot.title}
                      {panel.nowPosition === slot.position && (
                        <Badge className="ml-2">{t("demos.presenting")}</Badge>
                      )}
                      {panel.nowPosition !== null && slot.position < panel.nowPosition && (
                        <Badge variant="outline" className="ml-2">
                          {t("demos.presented")}
                        </Badge>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-fg">
                      {slot.table
                        ? t("demos.teamAtTable", { team: slot.teamName, table: slot.table })
                        : slot.teamName}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("demos.earlier", { title: slot.title })}
                      disabled={busy || index === 0}
                      onClick={() =>
                        move.mutate({
                          submissionId: slot.submissionId,
                          panelId: panel.id,
                          position: slot.position - 1,
                        })
                      }
                    >
                      <IconArrowUp />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("demos.later", { title: slot.title })}
                      disabled={busy || index === panel.slots.length - 1}
                      onClick={() =>
                        move.mutate({
                          submissionId: slot.submissionId,
                          panelId: panel.id,
                          position: slot.position + 1,
                        })
                      }
                    >
                      <IconArrowDown />
                    </Button>
                    {panels.length > 1 && (
                      <OptSelect
                        size="sm"
                        ariaLabel={t("demos.panelFor", { title: slot.title })}
                        value={panel.id}
                        disabled={busy}
                        options={panels.map((each) => ({ value: each.id, label: each.name }))}
                        onChange={(panelId) => {
                          if (panelId !== panel.id)
                            move.mutate({ submissionId: slot.submissionId, panelId });
                        }}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}

      {panels.length > 0 && waiting.length > 0 && (
        <p className="text-sm text-muted-fg">{t("demos.waiting", { count: waiting.length })}</p>
      )}
    </Screen.Section>
  );
}
