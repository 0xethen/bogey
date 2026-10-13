import { exportHref } from "#/lib/exports.ts";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconCheck, IconCircleX, IconPlus, IconTrash, IconDownload } from "@tabler/icons-react";
import {
  SESSION_KIND_ICONS,
  SESSION_KIND_TONES,
  sessionKindSchema,
  type SessionKind,
} from "@bogey/config/settings";
import {
  agendaQueryOptions,
  attendanceQueryOptions,
  saveAgendaFn,
  type Agenda,
  type AgendaSession,
  type AgendaSlot,
  type SessionVisibility,
  type SlotKind,
} from "@bogey/db/queries/sessions";
import { eventPeopleQueryOptions, removeWindowFn, setWindowsFn } from "@bogey/db/queries/manage";
import type { WindowChange } from "@bogey/db/queries/manage";
import { eventWindowsQueryOptions, type EventWindow } from "@bogey/db/queries/windows";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { pluginWindows } from "@bogey/plugins";
import { isoToWallTime, wallTimeToIso, formatTimeRange } from "@bogey/utils/time";
import { toSlug } from "@bogey/utils/keys";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import {
  EditableList,
  EditableListGroup,
  EditableListItem,
  type EditableListPosition,
} from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import { Timeline } from "#/components/event/agenda/timeline.tsx";
import { cn } from "@bogey/ui/lib/utils";
import { TimeFormatProvider, useTimeFormat } from "@bogey/ui/lib/time-format";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  schemaMetaOf,
  useAppForm,
} from "@bogey/ui/lib/form";
import { RequiredNote, SessionCard } from "#/components/event/agenda/agenda.tsx";
import {
  KIND_ICONS,
  KIND_TONES,
  KindBadge,
  resolveKind,
  UNTYPED,
} from "#/components/event/agenda/session-kind.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { useEventRefresh } from "#/lib/refresh.ts";
import { useSettingsMutation } from "#/lib/settings.ts";
import { CORE_WINDOWS, timelineItems, windowLabel } from "#/lib/windows.ts";

const agendaSettings = (eventId: string) =>
  settingsQueryOptions({ eventId }, ["agenda", "schedule"]);

import { sessionKindsWithPlugins } from "#/lib/plugins.ts";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/agenda")({
  staticData: {
    title: msg("eventTab.agenda"),
    command: { keywords: ["schedule", "sessions", "windows", "attendance"] },
    settings: (t) => [
      searchSection(t("manageAgenda.reminders"), { id: "reminders" }),
      ...searchSettings("agenda", ["reminderMinutes"], t),
      searchSection(t("manageAgenda.sessions"), {
        keywords: ["workshops", "slots", "hosts"],
        id: "sessions",
      }),
      searchSection(t("manageAgenda.windows"), {
        keywords: ["registration", "submissions", "judging", "results", "gallery", "open", "close"],
        id: "windows",
      }),
      searchSection(t("manageAgenda.types"), { id: "session-types" }),
      searchSection(t("manageAgenda.participantsSee"), { id: "what-participants-see" }),
      ...searchSettings("schedule", ["display", "showEventTimezone"], t),
      searchSection(t("manageAgenda.attendance"), {
        keywords: ["check-in", "codes"],
        id: "attendance",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(agendaQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPeopleQueryOptions(context.event.id)),
      context.query.ensureQueryData(attendanceQueryOptions(context.event.id)),
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
    <Screen
      title={t("eventTab.agenda")}
      description={
        <>
          {t("manageAgenda.intro", { zone: event.timezone.replace(/_/g, " ") })}
          <br />
          <RequiredNote />
        </>
      }
      width="embedded"
    >
      <TimeFormatProvider value={{ ...time, timeZone: event.timezone, zone: true }}>
        <SessionsEditor />
        <Windows />
      </TimeFormatProvider>
      <SessionTypes />
      <ParticipantView />
      <Screen.Section id="reminders" title={t("manageAgenda.reminders")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="agenda"
          keys={["reminderMinutes"]}
        />
      </Screen.Section>
      <Attendance />
      <PluginSettingSections page="agenda" />
    </Screen>
  );
}

const slotKinds = (t: T): Tuple<{ value: SlotKind; label: string; description: string }> => [
  {
    value: "everyone",
    label: t("manageAgenda.forEveryone"),
    description: t("manageAgenda.forEveryoneHelp"),
  },
  { value: "choose", label: t("agenda.chooseOne"), description: t("manageAgenda.chooseHelp") },
];

const visibilities = (t: T): Tuple<{ value: SessionVisibility; label: string }> => [
  { value: "everyone", label: t("badges.everyone") },
  { value: "staff", label: t("manageAgenda.staffHosts") },
];

const NO_CATEGORY = "none";
const WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const sessionSchema = (t: T) =>
  z
    .object({
      uid: z.string(),
      id: z.string(),
      kind: z.string().meta({ label: t("manageReg.type") }),
      name: z
        .string()
        .trim()
        .min(1, t("manageAgenda.giveName"))
        .max(120, t("form.maxLength", { max: 120 }))
        .meta({ label: t("checkin.name"), placeholder: t("manageAgenda.namePlaceholder") }),
      description: z
        .string()
        .max(20_000)
        .meta({ label: t("homeEditor.description") }),
      location: z
        .string()
        .max(200, t("form.maxLength", { max: 200 }))
        .meta({ label: t("details.location"), placeholder: t("manageAgenda.locationPlaceholder") }),
      starts: z
        .string()
        .meta({ label: t("manageAgenda.ownStart") })
        .describe(t("manageAgenda.ownStartHelp")),
      ends: z.string().meta({ label: t("manageAgenda.ownEnd") }),
      hostNote: z
        .string()
        .max(200, t("form.maxLength", { max: 200 }))
        .meta({
          label: t("manageAgenda.presentedBy"),
          placeholder: t("manageAgenda.presentedPlaceholder"),
        })
        .describe(t("manageAgenda.presentedHelp")),
      hosts: z
        .array(z.string())
        .meta({ label: t("manageAgenda.hosts"), placeholder: t("manageAgenda.hostsPlaceholder") })
        .describe(t("manageAgenda.hostsHelp")),
      capacity: z
        .string()
        .regex(/^\s*(\d*)\s*$/, t("manageAgenda.seatsRule"))
        .meta({ label: t("manageAgenda.seats"), placeholder: t("manageReg.noLimit") })
        .describe(t("manageAgenda.seatsHelp")),
      required: z
        .boolean()
        .meta({ label: t("agenda.required") })
        .describe(t("manageAgenda.requiredHelp")),
      takesAttendance: z
        .boolean()
        .meta({ label: t("agenda.takeAttendanceLabel") })
        .describe(t("manageAgenda.attendanceHelp")),
      visibility: z.enum(["everyone", "staff"]).meta({ label: t("manageAgenda.whoSees") }),
      category: z.string().meta({ label: t("manageAgenda.level") }),
    })
    .superRefine((value, ctx) => {
      if (value.starts && value.ends && value.ends <= value.starts) {
        ctx.addIssue({ code: "custom", path: ["ends"], message: t("manageAgenda.endsAfter") });
      }
    });

const slotFieldsSchema = (t: T) =>
  z
    .object({
      name: z.string().max(80, t("form.maxLength", { max: 80 })),
      starts: z.string().regex(WALL_TIME, t("manageAgenda.setStart")),
      ends: z.string(),
    })
    .superRefine((value, ctx) => {
      if (value.ends && value.ends <= value.starts) {
        ctx.addIssue({ code: "custom", path: ["ends"], message: t("manageAgenda.endsAfter") });
      }
    });

const slotSchema = (t: T) =>
  z
    .object({
      uid: z.string(),
      id: z.string(),
      name: z
        .string()
        .max(80, t("form.maxLength", { max: 80 }))
        .meta({ label: t("checkin.name"), placeholder: t("manageAgenda.slotPlaceholder") }),
      kind: z.enum(["everyone", "choose"]).meta({ label: t("facts.kind") }),
      starts: z
        .string()
        .regex(WALL_TIME, t("manageAgenda.setStart"))
        .meta({ label: t("eventForm.starts") }),
      ends: z.string().meta({ label: t("eventForm.ends") }),
      sessions: z.array(sessionSchema(t)).min(1, t("manageAgenda.addOneSession")).max(30),
    })
    .superRefine((value, ctx) => {
      if (value.ends && value.ends <= value.starts) {
        ctx.addIssue({ code: "custom", path: ["ends"], message: t("manageAgenda.endsAfter") });
      }
    });

const agendaSchema = (t: T) =>
  z.object({
    levels: z.array(
      z.object({
        kind: z.string(),
        labels: z.array(z.string()).meta({ placeholder: t("manageAgenda.levelPlaceholder") }),
      }),
    ),
    slots: z.array(slotSchema(t)).max(100),
  });

type AgendaValues = z.infer<ReturnType<typeof agendaSchema>>;
type SlotValues = AgendaValues["slots"][number];
type SessionValues = SlotValues["sessions"][number];

function blankSession(): SessionValues {
  return {
    uid: crypto.randomUUID(),
    id: "",
    kind: UNTYPED,
    name: "",
    description: "",
    location: "",
    starts: "",
    ends: "",
    hostNote: "",
    hosts: [],
    capacity: "",
    required: false,
    takesAttendance: false,
    visibility: "everyone",
    category: NO_CATEGORY,
  };
}

function levelKinds(kinds: Tuple<SessionKind>, agenda: Agenda): string[] {
  const listed = kinds.map((kind) => kind.key);
  const withLevels = agenda.categories.map((category) => category.kind);
  const untyped = listed.length === 0 ? [UNTYPED] : [];
  return [...new Set([...listed, ...untyped, ...withLevels])];
}

function toValues(agenda: Agenda, kinds: Tuple<SessionKind>, timeZone: string): AgendaValues {
  return {
    levels: levelKinds(kinds, agenda).map((kind) => ({
      kind,
      labels: agenda.categories
        .filter((category) => category.kind === kind)
        .map((category) => category.label),
    })),
    slots: agenda.slots.map((slot) => ({
      uid: slot.id,
      id: slot.id,
      name: slot.name ?? "",
      kind: slot.kind,
      starts: isoToWallTime(slot.startsAt, timeZone),
      ends: isoToWallTime(slot.endsAt, timeZone),
      sessions: slot.sessions.map((session) => ({
        uid: session.id,
        id: session.id,
        kind: session.kind,
        name: session.name,
        description: session.descriptionMd,
        location: session.location ?? "",
        starts: isoToWallTime(session.startsAt, timeZone),
        ends: isoToWallTime(session.endsAt, timeZone),
        hostNote: session.hostNote ?? "",
        hosts: session.hosts.map((host) => host.id),
        capacity: session.capacity === null ? "" : String(session.capacity),
        required: session.required,
        takesAttendance: session.takesAttendance,
        visibility: session.visibility,
        category: session.category ?? NO_CATEGORY,
      })),
    })),
  };
}

function previewOf(
  slot: SlotValues,
  session: SessionValues,
  names: ReadonlyMap<string, string>,
  taken: ReadonlyMap<string, number>,
  timeZone: string,
  t: T,
): { slot: AgendaSlot; session: AgendaSession } {
  const capacity = Number.parseInt(session.capacity, 10);
  return {
    slot: {
      id: slot.uid,
      name: slot.name || null,
      kind: slot.kind,
      startsAt: wallTimeToIso(slot.starts, timeZone) ?? new Date().toISOString(),
      endsAt: wallTimeToIso(slot.ends, timeZone),
      sessions: [],
    },
    session: {
      id: session.uid,
      kind: session.kind,
      name: session.name.trim() || t("manageAgenda.untitledSession"),
      descriptionMd: session.description,
      location: session.location.trim() || null,
      startsAt: wallTimeToIso(session.starts, timeZone),
      endsAt: wallTimeToIso(session.ends, timeZone),
      hostNote: session.hostNote.trim() || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      required: slot.kind === "everyone" && session.required,
      takesAttendance: session.takesAttendance,
      visibility: session.visibility,
      category: session.category === NO_CATEGORY ? null : session.category,
      hosts: session.hosts.map((id) => ({ id, name: names.get(id) ?? t("netSection.someone") })),
      taken: taken.get(session.id) ?? 0,
      mine: false,
      attended: false,
      canTakeAttendance: false,
    },
  };
}

function chosenLevel(levels: AgendaValues["levels"], session: SessionValues): string | null {
  const labels = levels.find((level) => level.kind === session.kind)?.labels ?? [];
  return labels.some((label) => label.trim() === session.category) ? session.category : null;
}

function slotHeading(slot: SlotValues, timeZone: string, t: T): string {
  const starts = wallTimeToIso(slot.starts, timeZone);
  const time = starts
    ? formatTimeRange(starts, wallTimeToIso(slot.ends, timeZone), { timeZone })
    : t("manageAgenda.noTime");
  const kind =
    slot.kind === "choose" ? t("manageAgenda.chooseOneLower") : t("manageAgenda.forEveryoneLower");
  return [time, slot.name.trim(), kind].filter(Boolean).join(" · ");
}

function nextStart(slots: Tuple<SlotValues>, fallback: string): string {
  const last = slots.at(-1);
  return last ? last.ends || last.starts : fallback;
}

function moveSession(
  slots: Tuple<SlotValues>,
  from: EditableListPosition,
  to: EditableListPosition,
): SlotValues[] {
  const source = slots.find((slot) => slot.uid === from.list);
  const moving = source?.sessions[from.index];
  if (!source || !moving) return [...slots];
  const without = slots.map((slot) =>
    slot.uid === from.list
      ? { ...slot, sessions: slot.sessions.filter((_, index) => index !== from.index) }
      : slot,
  );
  return without.map((slot) =>
    slot.uid === to.list
      ? { ...slot, sessions: slot.sessions.toSpliced(to.index, 0, moving) }
      : slot,
  );
}

function SessionsEditor() {
  const t = useT();
  const agendaForm = useMemo(() => agendaSchema(t), [t]);
  const slotForm = useMemo(() => slotFieldsSchema(t), [t]);
  const sessionForm = useMemo(() => sessionSchema(t), [t]);
  const { event, plugins } = Route.useRouteContext();
  const zone = event.timezone;
  const queryClient = useQueryClient();
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const { data: people } = useSuspenseQuery(eventPeopleQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(agendaSettings(event.id));
  const kinds = sessionKindsWithPlugins(settings.agenda.kinds, plugins);
  const [removed, setRemoved] = useState<number | null>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const hosts = people.members
    .filter((member) => member.role !== "participant")
    .sort((a, b) => a.name.localeCompare(b.name));
  const hostOptions = hosts.map((member) => ({
    value: member.userId,
    label: `${member.name} (${member.role})`,
  }));
  const names = new Map(hosts.map((member) => [member.userId, member.name]));
  const taken = new Map(
    agenda.slots.flatMap((slot) => slot.sessions.map((session) => [session.id, session.taken])),
  );

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: toValues(agenda, kinds, zone),
      errorVisibility,
      validators: [rewardEarlyPunishLate(agendaForm)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const iso = (wall: string) => (wall ? wallTimeToIso(wall, zone) : null);
      const result = await saveAgendaFn({
        data: {
          eventId: event.id,
          categories: value.levels.flatMap((level) =>
            level.labels
              .map((label) => label.trim())
              .filter(Boolean)
              .map((label) => ({ kind: level.kind, label })),
          ),
          slots: value.slots.map((slot) => ({
            id: slot.id || null,
            name: slot.name,
            kind: slot.kind,
            startsAt: iso(slot.starts) ?? "",
            endsAt: iso(slot.ends),
            sessions: slot.sessions.map((session) => {
              const capacity = Number.parseInt(session.capacity, 10);
              return {
                id: session.id || null,
                kind: session.kind,
                name: session.name,
                descriptionMd: session.description,
                location: session.location,
                startsAt: iso(session.starts),
                endsAt: iso(session.ends),
                hostNote: session.hostNote,
                hosts: session.hosts,
                capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
                required: slot.kind === "everyone" && session.required,
                takesAttendance: session.takesAttendance,
                visibility: session.visibility,
                category: chosenLevel(value.levels, session),
              };
            }),
          })),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setRemoved(result.data);
      await queryClient.invalidateQueries({ queryKey: attendanceQueryOptions(event.id).queryKey });
      const saved = await queryClient.fetchQuery({ ...agendaQueryOptions(event.id), staleTime: 0 });
      formApi.reset(toValues(saved, kinds, zone));
      setActive(null);
      setActiveSlot(null);
      return undefined;
    },
  });

  const kindOptions = (current: string) => [
    ...(kinds.some((kind) => kind.key === UNTYPED)
      ? []
      : [{ value: UNTYPED, label: t("manageAgenda.noType") }]),
    ...kinds.map((kind) => ({ value: kind.key, label: kind.label })),
    ...(current === UNTYPED || kinds.some((kind) => kind.key === current)
      ? []
      : [{ value: current, label: resolveKind(kinds, current).label }]),
  ];

  const sessionFields = (slotIndex: number, index: number, choose: boolean) => {
    const at = `slots[${slotIndex}].sessions[${index}]` as const;
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <form.Field name={`${at}.name`}>{(field) => <field.TextField required />}</form.Field>
          <form.Field name={`${at}.kind`}>
            {(field) => (
              <field.Field>
                <field.Label />
                <FieldSelect
                  field={field}
                  options={kindOptions(field.value)}
                  onValueChange={() => form.setFieldValue(`${at}.category`, NO_CATEGORY)}
                />
              </field.Field>
            )}
          </form.Field>
        </div>
        <form.Field name={`${at}.description`}>
          {(field) => <field.MarkdownField rows={3} />}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name={`${at}.location`}>{(field) => <field.TextField />}</form.Field>
          <form.Subscribe selector={(state) => state.values.levels}>
            {(levels) => (
              <form.Subscribe
                selector={(state) => state.values.slots[slotIndex]?.sessions[index]?.kind}
              >
                {(kind) => {
                  const labels = (levels.find((level) => level.kind === kind)?.labels ?? [])
                    .map((label) => label.trim())
                    .filter(Boolean);
                  return (
                    <form.Field name={`${at}.category`}>
                      {(field) => (
                        <field.Field>
                          <field.Label />
                          <FieldSelect
                            field={field}
                            options={[
                              { value: NO_CATEGORY, label: t("adminOrgs.none") },
                              ...labels.map((label) => ({ value: label, label })),
                            ]}
                          />
                        </field.Field>
                      )}
                    </form.Field>
                  );
                }}
              </form.Subscribe>
            )}
          </form.Subscribe>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name={`${at}.hosts`}>
            {(field) => (
              <field.MultiSelectField options={hostOptions} empty={t("manageAgenda.noHosts")} />
            )}
          </form.Field>
          <form.Field name={`${at}.hostNote`}>{(field) => <field.TextField />}</form.Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name={`${at}.starts`}>{(field) => <field.DateTimeField />}</form.Field>
          <form.Field name={`${at}.ends`}>{(field) => <field.DateTimeField />}</form.Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {choose && (
            <form.Field name={`${at}.capacity`}>{(field) => <field.TextField />}</form.Field>
          )}
          <form.Field name={`${at}.visibility`}>
            {(field) => (
              <field.Field>
                <field.Label />
                <FieldSelect field={field} options={visibilities(t)} />
              </field.Field>
            )}
          </form.Field>
        </div>
        {!choose && (
          <form.Field name={`${at}.required`}>{(field) => <field.SwitchField />}</form.Field>
        )}
        <form.Field name={`${at}.takesAttendance`}>{(field) => <field.SwitchField />}</form.Field>
      </div>
    );
  };

  return (
    <Screen.Section
      id="sessions"
      title={t("manageAgenda.sessions")}
      description={t("manageAgenda.sessionsHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-6">
          <form.Field name="levels">
            {(levels) =>
              levels.value.length > 0 && (
                <div className="flex flex-col gap-4">
                  {levels.value.map((level, levelIndex) => (
                    <form.Field key={level.kind} name={`levels[${levelIndex}].labels`}>
                      {(field) => (
                        <field.OptionsField
                          label={t("manageAgenda.levels", {
                            kind: resolveKind(kinds, level.kind).label,
                          })}
                          description={t("manageAgenda.levelsHelp", {
                            kind: resolveKind(kinds, level.kind).label.toLowerCase(),
                          })}
                        />
                      )}
                    </form.Field>
                  ))}
                </div>
              )
            }
          </form.Field>

          <form.Field name="slots">
            {(slots) => (
              <div className="flex flex-col gap-6">
                {slots.value.length === 0 && (
                  <p className="text-sm text-muted-fg">{t("manageAgenda.empty")}</p>
                )}
                <EditableListGroup
                  onMove={(from, to) => slots.handleChange(moveSession(slots.value, from, to))}
                >
                  {slots.value.map((slot, slotIndex) => {
                    const editingSlot =
                      activeSlot === slot.uid || !slotForm.safeParse(slot).success;
                    const heading = slotHeading(slot, zone, t);
                    return (
                      <section
                        key={slot.uid}
                        aria-label={heading}
                        className="flex flex-col gap-3 rounded-3xl border border-border p-4"
                      >
                        <div className="relative flex items-center gap-2">
                          {editingSlot ? (
                            <h3 className="min-w-0 flex-1 font-heading font-semibold">{heading}</h3>
                          ) : (
                            <button
                              type="button"
                              aria-label={t("manageAgenda.editSlot", { heading })}
                              onClick={() => setActiveSlot(slot.uid)}
                              className="-mx-2 -my-1 min-w-0 flex-1 rounded-xl px-2 py-1 text-left font-heading font-semibold hocus:bg-muted/40"
                            >
                              {heading}
                            </button>
                          )}
                          {editingSlot && activeSlot === slot.uid && (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              className="text-primary-text"
                              aria-label={t("manageAgenda.doneSlot")}
                              title={t("judging.done")}
                              onClick={() => setActiveSlot(null)}
                            >
                              <IconCheck />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive"
                            aria-label={t("manageAgenda.removeSlot")}
                            title={t("manageAgenda.removeSlot")}
                            confirm={{
                              title: t("manageAgenda.removeSlotTitle"),
                              description: t("manageAgenda.removeSlotBody", {
                                count: slot.sessions.length,
                              }),
                              label: t("twoFactor.remove"),
                            }}
                            onClick={() => slots.removeValue(slotIndex)}
                          >
                            <IconTrash />
                          </Button>
                        </div>

                        {editingSlot && (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <form.Field name={`slots[${slotIndex}].name`}>
                              {(field) => <field.TextField />}
                            </form.Field>
                            <form.Field name={`slots[${slotIndex}].kind`}>
                              {(field) => (
                                <field.Field>
                                  <field.Label />
                                  <FieldSelect field={field} options={slotKinds(t)} />
                                </field.Field>
                              )}
                            </form.Field>
                            <form.Field name={`slots[${slotIndex}].starts`}>
                              {(field) => <field.DateTimeField required />}
                            </form.Field>
                            <form.Field name={`slots[${slotIndex}].ends`}>
                              {(field) => <field.DateTimeField />}
                            </form.Field>
                          </div>
                        )}

                        <form.Field name={`slots[${slotIndex}].sessions`}>
                          {(list) => (
                            <>
                              <EditableList id={slot.uid} empty={t("manageAgenda.slotEmpty")}>
                                {list.value.map((session, index) => {
                                  const preview = previewOf(slot, session, names, taken, zone, t);
                                  return (
                                    <EditableListItem
                                      key={session.uid}
                                      id={session.uid}
                                      index={index}
                                      noun={t("manageAgenda.sessionNoun")}
                                      onRemove={() => list.removeValue(index)}
                                      confirmRemove={
                                        session.id
                                          ? t("manageAgenda.removeSessionWarning")
                                          : undefined
                                      }
                                      preview={
                                        <SessionCard
                                          session={preview.session}
                                          slot={preview.slot}
                                          kinds={kinds}
                                        />
                                      }
                                      editing={
                                        active === session.uid ||
                                        !sessionForm.safeParse(session).success
                                      }
                                      onEdit={() => setActive(session.uid)}
                                      onDone={() => setActive(null)}
                                    >
                                      {sessionFields(slotIndex, index, slot.kind === "choose")}
                                    </EditableListItem>
                                  );
                                })}
                              </EditableList>
                              <div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const next = blankSession();
                                    list.pushValue(next);
                                    setActive(next.uid);
                                  }}
                                >
                                  <IconPlus />
                                  {t("manageAgenda.addSession")}
                                </Button>
                              </div>
                            </>
                          )}
                        </form.Field>
                      </section>
                    );
                  })}
                </EditableListGroup>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      const first = blankSession();
                      slots.pushValue({
                        uid,
                        id: "",
                        name: "",
                        kind: "everyone",
                        starts: nextStart(slots.value, isoToWallTime(event.starts_at, zone)),
                        ends: "",
                        sessions: [first],
                      });
                      setActiveSlot(uid);
                      setActive(first.uid);
                    }}
                  >
                    <IconPlus />
                    {t("manageAgenda.addSlot")}
                  </Button>
                </div>
              </div>
            )}
          </form.Field>

          <form.FormAlert title={t("manageAgenda.saveFailed")} />
          {removed !== null && removed > 0 && (
            <p role="status" className="text-sm text-muted-fg">
              {t("manageAgenda.savedRemoved", { count: removed })}
            </p>
          )}
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

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
        <div>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive w-full"
            disabled={remove.isPending}
            confirm={{
              title: t("manageAgenda.removeWindowTitle", { name: windowLabel(window, t) }),
              description: t("manageAgenda.removeWindowBody"),
              label: t("twoFactor.remove"),
            }}
            onClick={() => remove.mutate()}
          >
            <IconCircleX />
            {t("manageAgenda.removeWindow")}
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

const kindValuesSchema = (t: T) =>
  z.object({
    kinds: z
      .array(
        sessionKindSchema.omit({ key: true }).extend({
          uid: z.string(),
          key: z.string(),
          label: sessionKindSchema.shape.label.meta({
            label: t("checkin.name"),
            placeholder: t("manageAgenda.workshop"),
          }),
          tone: sessionKindSchema.shape.tone.meta({ label: t("manageAgenda.color") }),
          icon: sessionKindSchema.shape.icon.meta({ label: t("manageAgenda.icon") }),
        }),
      )
      .max(40),
  });

type KindValues = z.infer<ReturnType<typeof kindValuesSchema>>["kinds"][number];

function withKeys(kinds: Tuple<KindValues>): SessionKind[] {
  const taken = new Set(kinds.map((kind) => kind.key).filter(Boolean));
  return kinds.map(({ uid: _uid, ...kind }) => {
    if (kind.key) return kind;
    const base = toSlug(kind.label, 40).replace(/^[^a-z]+/, "") || "type";
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    taken.add(key);
    return { ...kind, key };
  });
}

function SessionTypes() {
  const t = useT();
  const schema = useMemo(() => kindValuesSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(agendaSettings(event.id));
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "agenda");
  const [active, setActive] = useState<string | null>(null);
  const used = new Map<string, number>();
  for (const session of agenda.slots.flatMap((slot) => slot.sessions)) {
    used.set(session.kind, (used.get(session.kind) ?? 0) + 1);
  }

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        kinds: settings.agenda.kinds.map((kind) => ({ ...kind, uid: kind.key })),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const kinds = withKeys(value.kinds);
      try {
        await save.mutateAsync({ kinds });
      } catch (error) {
        return createValidationError(
          error instanceof Error ? error.message : t("manageAgenda.typesFailed"),
        );
      }
      formApi.reset({ kinds: kinds.map((kind) => ({ ...kind, uid: kind.key })) });
      setActive(null);
      return undefined;
    },
  });

  return (
    <Screen.Section
      id="session-types"
      title={t("manageAgenda.types")}
      description={t("manageAgenda.typesHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="kinds">
            {(list) => (
              <>
                <EditableList
                  onMove={(from, to) => list.moveValue(from, to)}
                  empty={t("manageAgenda.noTypes")}
                >
                  {list.value.map((kind, index) => {
                    const count = kind.key ? (used.get(kind.key) ?? 0) : 0;
                    return (
                      <EditableListItem
                        key={kind.uid}
                        id={kind.uid}
                        index={index}
                        noun={t("manageAgenda.typeNoun")}
                        onRemove={() => list.removeValue(index)}
                        confirmRemove={
                          count > 0 ? t("manageAgenda.typeInUse", { count }) : undefined
                        }
                        preview={
                          <div className="flex min-h-7 items-center gap-3">
                            <KindBadge
                              kind={{
                                ...kind,
                                label: kind.label || t("manageAgenda.untitledType"),
                              }}
                            />
                            <span className="text-sm text-muted-fg">
                              {count > 0
                                ? t("manageAgenda.sessionCount", { count })
                                : t("manageAgenda.unused")}
                            </span>
                          </div>
                        }
                        editing={
                          active === kind.uid || !schema.shape.kinds.element.safeParse(kind).success
                        }
                        onEdit={() => setActive(kind.uid)}
                        onDone={() => setActive(null)}
                      >
                        <div className="flex flex-col gap-4">
                          <form.Field name={`kinds[${index}].label`}>
                            {(field) => <field.TextField required />}
                          </form.Field>
                          <form.Field name={`kinds[${index}].tone`}>
                            {(field) => (
                              <Field>
                                <FieldLabel>{schemaMetaOf(field).label}</FieldLabel>
                                <div
                                  role="radiogroup"
                                  aria-label={schemaMetaOf(field).label}
                                  className="flex flex-wrap gap-1.5"
                                >
                                  {SESSION_KIND_TONES.map((tone) => (
                                    <button
                                      key={tone}
                                      type="button"
                                      role="radio"
                                      aria-checked={field.value === tone}
                                      aria-label={t(KIND_TONES[tone].label)}
                                      title={t(KIND_TONES[tone].label)}
                                      onClick={() => field.handleChange(tone)}
                                      className={cn(
                                        "flex size-8 items-center justify-center rounded-pill ring-offset-2 ring-offset-background",
                                        "aria-checked:ring-2 aria-checked:ring-fg hocus:ring-2 hocus:ring-border",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "size-6 rounded-pill",
                                          KIND_TONES[tone].swatch,
                                        )}
                                      />
                                    </button>
                                  ))}
                                </div>
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name={`kinds[${index}].icon`}>
                            {(field) => (
                              <Field>
                                <FieldLabel>{schemaMetaOf(field).label}</FieldLabel>
                                <div
                                  role="radiogroup"
                                  aria-label={schemaMetaOf(field).label}
                                  className="flex flex-wrap gap-1"
                                >
                                  {SESSION_KIND_ICONS.map((icon) => {
                                    const Icon = KIND_ICONS[icon];
                                    return (
                                      <button
                                        key={icon}
                                        type="button"
                                        role="radio"
                                        aria-checked={field.value === icon}
                                        aria-label={icon}
                                        title={icon}
                                        onClick={() => field.handleChange(icon)}
                                        className={cn(
                                          "flex size-9 items-center justify-center rounded-xl text-muted-fg hocus:bg-muted hocus:text-fg",
                                          "aria-checked:bg-primary/10 aria-checked:text-primary-text aria-checked:ring-1 aria-checked:ring-primary/40",
                                        )}
                                      >
                                        <Icon className="size-4.5" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </Field>
                            )}
                          </form.Field>
                        </div>
                      </EditableListItem>
                    );
                  })}
                </EditableList>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({ uid, key: "", label: "", tone: "gray", icon: "calendar" });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("manageAgenda.addType")}
                  </Button>
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title={t("manageAgenda.typesSaveFailed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
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
        keys={["display", "showEventTimezone"]}
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

function Attendance() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const { data: rows } = useSuspenseQuery(attendanceQueryOptions(event.id));
  const [missingOnly, setMissingOnly] = useState(false);

  const sessions = agenda.slots.flatMap((slot) =>
    slot.sessions
      .filter((session) => session.takesAttendance)
      .map((session) => ({ slot, session })),
  );
  if (sessions.length === 0) return null;

  const names = new Map(sessions.map(({ session }) => [session.id, session.name]));
  const order = new Map(sessions.map(({ session }, index) => [session.id, index]));
  const people = new Map<string, { name: string; expected: string[]; attended: string[] }>();
  for (const row of rows) {
    const person = people.get(row.userId) ?? { name: row.name, expected: [], attended: [] };
    if (row.expected) person.expected.push(row.sessionId);
    if (row.attendedAt) person.attended.push(row.sessionId);
    people.set(row.userId, person);
  }
  const summaries = [...people.entries()].map(([userId, person]) => {
    const missed = person.expected
      .filter((id) => !person.attended.includes(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map((id) => names.get(id) ?? t("manageAgenda.aSession"));
    return {
      userId,
      name: person.name,
      expected: person.expected.length,
      attendedExpected: person.expected.length - missed.length,
      extra: person.attended.filter((id) => !person.expected.includes(id)).length,
      missed,
    };
  });
  const list = summaries
    .filter((person) => !missingOnly || person.missed.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen.Section
      id="attendance"
      title={t("manageAgenda.attendance")}
      description={t("manageAgenda.attendanceIntro")}
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={exportHref(event.slug, "attendance")} download />}
        >
          <IconDownload />
          {t("manageTeams.export")}
        </Button>
      }
    >
      <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
        {sessions.map(({ slot, session }) => {
          const here = rows.filter((row) => row.sessionId === session.id && row.attendedAt).length;
          const expected = rows.filter(
            (row) => row.sessionId === session.id && row.expected,
          ).length;
          return (
            <li key={session.id} className="flex flex-wrap items-center gap-3 px-2 py-2.5">
              <span className="w-32 text-muted-fg tabular-nums">
                {formatTimeRange(session.startsAt ?? slot.startsAt, session.endsAt ?? slot.endsAt, {
                  timeZone: event.timezone,
                })}
              </span>
              <span className="flex-1 font-medium">{session.name}</span>
              <span className="text-muted-fg">
                {expected > 0
                  ? t("session.here", { here, total: expected })
                  : t("manageAgenda.hereOnly", { here })}
              </span>
              {session.canTakeAttendance && (
                <Button
                  size="sm"
                  variant="ghost"
                  nativeButton={false}
                  render={
                    <Link
                      to="/events/$slug/agenda/$sessionId"
                      params={{ slug: event.slug, sessionId: session.id }}
                    />
                  }
                >
                  {t("agenda.takeAttendance")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Field orientation="horizontal" className="justify-between">
        <FieldLabel htmlFor="missing-only">{t("manageAgenda.missedOnly")}</FieldLabel>
        <Switch id="missing-only" checked={missingOnly} onCheckedChange={setMissingOnly} />
      </Field>
      {list.length === 0 ? (
        <p className="text-sm text-muted-fg">
          {missingOnly ? t("manageAgenda.nobodyMissed") : t("netSection.noParticipants")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
          {list.map((person) => (
            <li
              key={person.userId}
              className="flex flex-col gap-0.5 px-2 py-2.5 sm:flex-row sm:gap-3"
            >
              <span className="font-medium sm:w-48">{person.name}</span>
              <span className="text-muted-fg">
                {person.expected > 0
                  ? t("manageAgenda.expectedOf", {
                      done: person.attendedExpected,
                      total: person.expected,
                    })
                  : t("manageAgenda.nothingRequired")}
                {person.extra > 0 && `, ${t("manageAgenda.plusOthers", { count: person.extra })}`}
                {person.missed.length > 0 &&
                  ` · ${t("manageAgenda.missed", { list: person.missed.join(", ") })}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Screen.Section>
  );
}
