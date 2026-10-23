import { createFileRoute } from "@tanstack/react-router";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { TimeFormatProvider, useTimeFormat } from "@bogey/ui/lib/time-format";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { useMemo, useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconBell, IconBellOff, IconCircleX } from "@tabler/icons-react";
import { removeWindowFn, setWindowsFn } from "@bogey/db/queries/manage";
import type { WindowChange } from "@bogey/db/queries/manage";
import { eventWindowsQueryOptions, type EventWindow } from "@bogey/db/queries/windows";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { pluginWindows } from "@bogey/plugins";
import { isoToWallTime, wallTimeToIso } from "@bogey/utils/time";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@bogey/ui/components/popover";
import { RadioGroup, RadioGroupItem } from "@bogey/ui/components/radio-group";
import { Screen } from "@bogey/ui/components/screen";
import { Timeline } from "#/components/event/agenda/timeline.tsx";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useEventRefresh } from "#/lib/refresh.ts";
import { useSettingsMutation } from "#/lib/settings.ts";
import { SettingLink } from "#/components/settings/setting-link.tsx";
import { CORE_WINDOWS, timelineItems, windowLabel } from "#/lib/windows.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { agendaSettings } from "./-components/agenda-shared.ts";

type Mode = "scheduled" | "open" | "closed";

const modes = (t: T): Tuple<{ value: Mode; label: string }> => [
  { value: "scheduled", label: t("manageAgenda.scheduled") },
  { value: "open", label: t("manageAgenda.openNow") },
  { value: "closed", label: t("manageAgenda.closeNow") },
];

function Windows() {
  const t = useT();
  const { event, plugins } = Route.useRouteContext();
  const refreshEvent = useEventRefresh(event.id);
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const add = useMutation({
    mutationFn: async (changes: WindowChange[]) =>
      unwrap(await setWindowsFn({ data: { eventId: event.id, windows: changes } })),
    onSuccess: refreshEvent,
  });
  const [adding, setAdding] = useState<string | null>(null);
  const [unchosen, setUnchosen] = useState(false);
  const offered = [...CORE_WINDOWS, ...pluginWindows(plugins).map((window) => window.key)];
  const missing = offered.filter((key) => !windows.some((window) => window.key === key));

  return (
    <Screen.Section
      id="windows"
      title={t("manageAgenda.windows")}
      description={t("manageAgenda.windowsHelp")}
      actions={
        missing.length > 0 && (
          <div className="flex items-center gap-2">
            <OptSelect
              ariaLabel={t("manageAgenda.windowToAdd")}
              size="sm"
              value={adding}
              placeholder={t("manageAgenda.addWindow")}
              options={missing.map((key) => ({ value: key, label: windowLabel({ key }, t) }))}
              onChange={setAdding}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={add.isPending}
              onClick={() => {
                if (!adding) return setUnchosen(true);
                add.mutate([{ key: adding, opens_at: null, closes_at: null, override: null }], {
                  onSuccess: () => setAdding(null),
                });
              }}
            >
              {t("manageAgenda.add")}
            </Button>
          </div>
        )
      }
    >
      <ErrorAlert
        error={unchosen && !adding ? t("manageAgenda.chooseWindowFirst") : null}
        title={t("manageAgenda.nothingToAdd")}
      />
      <ErrorAlert error={add.error} title={t("manageAgenda.addFailed")} />
      {windows.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageAgenda.noWindows")}</p>
      ) : (
        <Timeline
          divided={false}
          items={timelineItems(
            windows,
            (window) => (
              <WindowEditor
                key={`${window.key}-${window.updated_at}`}
                window={window}
                eventId={event.id}
                timeZone={event.timezone}
              />
            ),
            undefined,
            t,
          )}
        />
      )}
    </Screen.Section>
  );
}

const windowSchema = (t: T) =>
  z
    .object({
      mode: z.enum(["scheduled", "open", "closed"]).meta({ label: t("manageAgenda.mode") }),
      opens: z.string().meta({ label: t("timeline.opens") }),
      closes: z.string().meta({ label: t("timeline.closes") }),
      reminder: z.enum(["default", "none", "custom"]),
      minutes: z
        .number()
        .int()
        .min(1)
        .max(1440)
        .meta({ label: t("manageAgenda.reminderMinutes") }),
    })
    .superRefine((value, ctx) => {
      if (
        value.mode === "scheduled" &&
        value.opens &&
        value.closes &&
        value.closes <= value.opens
      ) {
        ctx.addIssue({ code: "custom", path: ["closes"], message: t("manageAgenda.closesAfter") });
      }
    });

function WindowEditor({
  window,
  eventId,
  timeZone,
}: {
  window: EventWindow;
  eventId: string;
  timeZone: string;
}) {
  const t = useT();
  const schema = useMemo(() => windowSchema(t), [t]);
  const refreshEvent = useEventRefresh(eventId);
  const eventSlug = Route.useRouteContext().event.slug;
  const { data: settings } = useSuspenseQuery(agendaSettings(eventId));
  const fallback = settings.agenda.reminderMinutes;
  const remove = useMutation({
    mutationFn: async () => unwrap(await removeWindowFn({ data: { eventId, key: window.key } })),
    onSuccess: refreshEvent,
  });
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        mode: window.override ?? "scheduled",
        opens: isoToWallTime(window.opens_at, timeZone),
        closes: isoToWallTime(window.closes_at, timeZone),
        reminder: reminderOf(window.reminder_minutes),
        minutes: window.reminder_minutes || fallback || 5,
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const change: WindowChange = {
        key: window.key,
        opens_at: wallTimeToIso(value.opens, timeZone),
        closes_at: wallTimeToIso(value.closes, timeZone),
        override: value.mode === "scheduled" ? null : value.mode,
        reminder_minutes:
          value.reminder === "default" ? null : value.reminder === "none" ? 0 : value.minutes,
      };
      const result = await setWindowsFn({ data: { eventId, windows: [change] } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      await refreshEvent();
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-3">
        <form.Field name="mode">
          {(field) => (
            <field.Field>
              <field.Label />
              <FieldSelect field={field} options={modes(t)} />
            </field.Field>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.mode === "scheduled"}>
          {(scheduled) =>
            scheduled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="opens">{(field) => <field.DateTimeField />}</form.Field>
                <form.Field name="closes">{(field) => <field.DateTimeField />}</form.Field>
              </div>
            )
          }
        </form.Subscribe>
        <form.FormAlert title={t("manageAgenda.windowSaveFailed")} />
        <ErrorAlert error={remove.error} title={t("manageAgenda.removeWindowFailed")} />
        <div className="grid grid-cols-2 gap-2">
          <Popover>
            <form.Subscribe selector={(state) => state.values.reminder}>
              {(reminder) => (
                <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                  {reminder === "none" ? <IconBellOff /> : <IconBell />}
                  {t("manageAgenda.setReminder")}
                </PopoverTrigger>
              )}
            </form.Subscribe>
            <PopoverContent align="start">
              <PopoverHeader>
                <PopoverTitle>{t("manageAgenda.reminderTitle")}</PopoverTitle>
                <PopoverDescription>
                  {t("manageAgenda.reminderHelp", { name: windowLabel(window, t) })}
                </PopoverDescription>
              </PopoverHeader>
              <form.Field name="reminder">
                {(field) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={(next) => {
                      if (next === "default" || next === "none" || next === "custom") {
                        field.handleChange(next);
                      }
                    }}
                  >
                    {(
                      [
                        [
                          "default",
                          fallback > 0
                            ? t("manageAgenda.reminderDefault", { minutes: fallback })
                            : t("manageAgenda.reminderDefaultOff"),
                        ],
                        ["none", t("manageAgenda.reminderNone")],
                        ["custom", t("manageAgenda.reminderCustom")],
                      ] as const
                    ).map(([value, label]) => (
                      <Field key={value} orientation="horizontal">
                        <RadioGroupItem value={value} id={`${window.key}-reminder-${value}`} />
                        <FieldLabel
                          htmlFor={`${window.key}-reminder-${value}`}
                          className="font-normal"
                        >
                          {label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </RadioGroup>
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.reminder === "custom"}>
                {(custom) =>
                  custom && (
                    <form.Field name="minutes">
                      {(field) => <field.NumberField min={1} max={1440} />}
                    </form.Field>
                  )
                }
              </form.Subscribe>
              <FieldDescription>
                <SettingLink
                  to={`/events/${eventSlug}/manage/agenda/windows`}
                  hash="agenda.reminderMinutes"
                >
                  {t("manageAgenda.reminderDefaultLink")}
                </SettingLink>
              </FieldDescription>
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={remove.isPending}
            confirm={{
              title: t("manageAgenda.removeWindowTitle", { name: windowLabel(window, t) }),
              description: t("manageAgenda.removeWindowBody"),
              label: t("twoFactor.remove"),
            }}
            onClick={() => remove.mutate()}
          >
            <IconCircleX />
            <span className="sm:hidden">{t("manageAgenda.removeShort")}</span>
            <span className="max-sm:hidden">{t("manageAgenda.removeWindow")}</span>
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

function reminderOf(minutes: number | null): "default" | "none" | "custom" {
  return minutes === null ? "default" : minutes === 0 ? "none" : "custom";
}

function ParticipantView() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(agendaSettings(event.id));
  const current = settings.schedule;
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "schedule");
  const [hidden, setHidden] = useDraft(
    current.hiddenWindows,
    async (hiddenWindows) => {
      try {
        await save.mutateAsync({ hiddenWindows: [...hiddenWindows] });
        return true;
      } catch {
        return false;
      }
    },
    (a, b) => a.length === b.length && a.every((key) => b.includes(key)),
  );

  return (
    <Screen.Section
      id="what-participants-see"
      title={t("manageAgenda.participantsSee")}
      description={t("manageAgenda.participantsSeeHelp")}
    >
      <SettingFields
        scope={{ scope: "event", eventId: event.id }}
        namespace="schedule"
        keys={["display", "showEventTimezone", "countdownLabel"]}
      />
      <SettingFields
        scope={{ scope: "event", eventId: event.id }}
        namespace="agenda"
        keys={["tabMenu"]}
      />
      {current.display !== "hidden" && (
        <ul className="flex flex-col gap-2">
          {windows.map((window) => (
            <li key={window.key}>
              <Field orientation="horizontal">
                <Checkbox
                  id={`show-${window.key}`}
                  checked={!hidden.includes(window.key)}
                  onCheckedChange={(checked) =>
                    setHidden(
                      checked
                        ? hidden.filter((key) => key !== window.key)
                        : [...hidden, window.key],
                    )
                  }
                />
                <FieldLabel htmlFor={`show-${window.key}`} className="font-normal">
                  {windowLabel(window, t)}
                </FieldLabel>
              </Field>
            </li>
          ))}
        </ul>
      )}
      <ErrorAlert error={save.error} title={t("manageAgenda.seeFailed")} />
    </Screen.Section>
  );
}

export const Route = createFileRoute("/_authed/events/$slug/manage/agenda/windows")({
  staticData: {
    title: msg("manageAgenda.windows"),
    settings: (t) => [
      searchSection(t("manageAgenda.windows"), {
        keywords: ["registration", "submissions", "judging", "results", "gallery", "open", "close"],
        id: "windows",
      }),
      searchSection(t("manageAgenda.participantsSee"), { id: "what-participants-see" }),
      ...searchSettings("schedule", ["display", "showEventTimezone", "countdownLabel"], t),
      ...searchSettings("agenda", ["tabMenu"], t),
      searchSection(t("manageAgenda.reminders"), { id: "reminders" }),
      ...searchSettings("agenda", ["reminderMinutes"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
      context.query.ensureQueryData(agendaSettings(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "schedule",
        "agenda",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const time = useTimeFormat();
  return (
    <Screen title={t("manageAgenda.windows")} width="embedded">
      <TimeFormatProvider value={{ ...time, timeZone: event.timezone, zone: true }}>
        <Windows />
      </TimeFormatProvider>
      <ParticipantView />
      <Screen.Section id="reminders" title={t("manageAgenda.reminders")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="agenda"
          keys={["reminderMinutes"]}
        />
      </Screen.Section>
    </Screen>
  );
}
