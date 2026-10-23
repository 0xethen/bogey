import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconCheck, IconPlus, IconTrash } from "@tabler/icons-react";
import { type SessionKind } from "@bogey/config/settings";
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
import { eventPeopleQueryOptions } from "@bogey/db/queries/manage";
import { requestFailure } from "@bogey/db/errors";
import { isoToWallTime, wallTimeToIso, formatTimeRange } from "@bogey/utils/time";
import { Button } from "@bogey/ui/components/button";
import {
  EditableList,
  EditableListGroup,
  EditableListItem,
  type EditableListPosition,
} from "@bogey/ui/components/editable-list";
import { Screen } from "@bogey/ui/components/screen";
import { TimeFormatProvider, useTimeFormat } from "@bogey/ui/lib/time-format";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { RequiredNote, SessionCard } from "#/components/event/agenda/agenda.tsx";
import { resolveKind, UNTYPED } from "#/components/event/agenda/session-kind.tsx";
import { sessionKindsWithPlugins } from "#/lib/plugins.ts";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";
import { agendaSettings, levelsOf } from "./-components/agenda-shared.ts";

// where the settings that moved off this page now live
const MOVED: Record<string, "agenda-types" | "agenda-windows" | "agenda-attendance"> = {
  "session-types": "agenda-types",
  windows: "agenda-windows",
  reminders: "agenda-windows",
  "what-participants-see": "agenda-windows",
  "agenda.reminderMinutes": "agenda-windows",
  "agenda.tabMenu": "agenda-windows",
  "schedule.display": "agenda-windows",
  "schedule.showEventTimezone": "agenda-windows",
  "schedule.countdownLabel": "agenda-windows",
  attendance: "agenda-attendance",
};

export const Route = createFileRoute("/_authed/events/$slug/manage/agenda/")({
  // a session's page links here with its id to open it for editing
  validateSearch: z.object({ session: z.string().optional() }),
  beforeLoad: ({ params, location }) => {
    const moved = MOVED[decodeURIComponent(location.hash)];
    if (moved === "agenda-types") {
      throw redirect({
        to: "/events/$slug/manage/agenda/types",
        params,
        hash: location.hash,
        replace: true,
      });
    }
    if (moved === "agenda-windows") {
      throw redirect({
        to: "/events/$slug/manage/agenda/windows",
        params,
        hash: location.hash,
        replace: true,
      });
    }
    if (moved === "agenda-attendance") {
      throw redirect({
        to: "/events/$slug/manage/agenda/attendance",
        params,
        hash: location.hash,
        replace: true,
      });
    }
  },
  staticData: {
    title: msg("eventTab.agenda"),
    command: { keywords: ["schedule", "sessions", "windows", "attendance"] },
    settings: (t) => [
      searchSection(t("manageAgenda.sessions"), {
        keywords: ["workshops", "slots", "hosts"],
        id: "sessions",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(agendaQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPeopleQueryOptions(context.event.id)),
      context.query.ensureQueryData(agendaSettings(context.event.id)),
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
      </TimeFormatProvider>
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
      page: z
        .string()
        .max(50_000)
        .meta({ label: t("manageAgenda.page") })
        .describe(t("manageAgenda.pageHelp")),
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
    page: "",
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

// a kind that isn't a defined type (an old one-off tag) is treated as no type; plugin kinds are kept
function typeOf(kinds: Tuple<SessionKind>, kind: string): string {
  return kind.includes(".") || kinds.some((each) => each.key === kind) ? kind : UNTYPED;
}

function toValues(agenda: Agenda, kinds: Tuple<SessionKind>, timeZone: string): AgendaValues {
  return {
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
        kind: typeOf(kinds, session.kind),
        name: session.name,
        description: session.descriptionMd,
        page: session.pageMd,
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
      pageMd: session.page,
      hasPage: session.takesAttendance || session.page.trim() !== "",
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

function chosenLevel(agenda: Agenda, session: SessionValues): string | null {
  return levelsOf(agenda, session.kind).includes(session.category) ? session.category : null;
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
  // an existing session's uid is its id
  const [active, setActive] = useState<string | null>(Route.useSearch().session ?? null);

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
                pageMd: session.page,
                location: session.location,
                startsAt: iso(session.starts),
                endsAt: iso(session.ends),
                hostNote: session.hostNote,
                hosts: session.hosts,
                capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
                required: slot.kind === "everyone" && session.required,
                takesAttendance: session.takesAttendance,
                visibility: session.visibility,
                category: chosenLevel(agenda, session),
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
  const levelOptions = (kind: string) => levelsOf(agenda, kind);

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
          <form.Subscribe
            selector={(state) => state.values.slots[slotIndex]?.sessions[index]?.kind}
          >
            {(kind) => {
              const labels = levelOptions(kind ?? UNTYPED);
              return (
                labels.length > 0 && (
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
                )
              );
            }}
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
        <form.Field name={`${at}.page`}>{(field) => <field.MarkdownField rows={5} />}</form.Field>
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
