import { Fragment, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconFlag, IconMapPin, IconUsers } from "@tabler/icons-react";
import type { SessionKind } from "@bogey/config/settings";
import {
  agendaQueryOptions,
  checkInFn,
  chooseSessionFn,
  leaveSlotFn,
  type Agenda,
  type AgendaSession,
  type AgendaSlot,
} from "@bogey/db/queries/sessions";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { useCan } from "@bogey/db/permissions";
import {
  dateParts,
  formatDate,
  formatTime,
  formatTimeRange,
  type FormatOptions,
} from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Markdown } from "@bogey/ui/components/markdown";
import { Marker, MarkerContent } from "@bogey/ui/components/marker";
import { cn } from "@bogey/ui/lib/utils";
import { useNow } from "@bogey/ui/hooks/now";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { z } from "zod";
import { useMemo } from "react";
import { milestoneLabel, type Milestone } from "#/lib/windows.ts";
import { useLocale } from "@bogey/ui/lib/locale";
import { KindBadge, shownKind } from "#/components/event/agenda/session-kind.tsx";
import { useSession } from "#/lib/viewer.ts";
import { useT, type T } from "#/lib/translate.tsx";

export function sessionTimes(
  session: Pick<AgendaSession, "startsAt" | "endsAt">,
  slot: Pick<AgendaSlot, "startsAt" | "endsAt">,
) {
  return {
    start: session.startsAt ?? slot.startsAt,
    end: session.endsAt ?? (session.startsAt ? null : slot.endsAt),
  };
}

/**
 * Whether the viewer takes a session's attendance. The agenda's `canTakeAttendance` is the real
 * role's answer; this narrows it to the role being viewed as, keeping sessions the viewer hosts.
 */
export function useTakesAttendance(): (session: AgendaSession) => boolean {
  const attendance = useCan("sessions.attendance");
  const me = useSession()?.user.id;
  return (session) =>
    session.canTakeAttendance && (attendance || session.hosts.some((host) => host.id === me));
}

function seatsLeft(session: AgendaSession): number | null {
  return session.capacity === null ? null : Math.max(0, session.capacity - session.taken);
}

export function RequiredMark() {
  const t = useT();
  return (
    <span className="text-destructive" title={t("agenda.required")}>
      <span aria-hidden>*</span>
      <span className="sr-only">({t("agenda.requiredLower")})</span>
    </span>
  );
}

export function RequiredNote() {
  const t = useT();
  return (
    <>
      {t("agenda.requiredBefore")} <RequiredMark /> {t("agenda.requiredAfter")}
    </>
  );
}

export function hasRequired(agenda: Agenda): boolean {
  return agenda.slots.some((slot) => slot.sessions.some((session) => session.required));
}

export function SessionCard({
  session,
  slot,
  kinds,
  actions,
  className,
  slug,
  named = true,
}: {
  session: AgendaSession;
  slot: AgendaSlot;
  kinds: Tuple<SessionKind>;
  actions?: ReactNode;
  className?: string;
  /** Links the name to the session's page, when it has one. */
  slug?: string;
  /** False on the session's own page, which has the name as its title. */
  named?: boolean;
}) {
  const t = useT();
  const time = useTimeFormat();
  const { start, end } = sessionTimes(session, slot);
  const ownTimes = session.startsAt !== null || session.endsAt !== null;
  const hosts = [...session.hosts.map((host) => host.name), session.hostNote].filter(Boolean);
  const left = slot.kind === "choose" ? seatsLeft(session) : null;
  const kind = shownKind(kinds, session.kind);

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {named && (
            <h3 className="text-base font-medium">
              {slug && session.hasPage ? (
                <Link
                  to="/events/$slug/agenda/$sessionId"
                  params={{ slug, sessionId: session.id }}
                  className="link"
                >
                  {session.name}
                </Link>
              ) : (
                session.name
              )}
              {session.required && <RequiredMark />}
            </h3>
          )}
          {named && kind && <KindBadge kind={kind} />}
          {named && session.category && <Badge variant="secondary">{session.category}</Badge>}
          {session.visibility === "staff" && (
            <Badge variant="outline">{t("agenda.staffOnly")}</Badge>
          )}
          {session.attended && (
            <Badge>
              <IconCheck />
              {t("session.checkedIn")}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-fg">
          {!named && kind && (
            <span className="text-fg">
              {kind.label}
              {session.category ? ` (${session.category})` : ""}
            </span>
          )}
          {ownTimes && <span>{formatTimeRange(start, end, time)}</span>}
          {session.location && (
            <span className="inline-flex items-center gap-1">
              <IconMapPin className="size-3.5" />
              {session.location}
            </span>
          )}
          {hosts.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <IconUsers className="size-3.5" />
              {hosts.join(", ")}
            </span>
          )}
          {left !== null && (
            <span>{left === 0 ? t("agenda.full") : t("agenda.seatsLeft", { count: left })}</span>
          )}
        </div>
        <Markdown className="text-muted-fg">{session.descriptionMd}</Markdown>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function OrSeparator() {
  const t = useT();
  return (
    <Marker variant="separator" className="text-xs" role="separator">
      <MarkerContent>{t("agenda.or")}</MarkerContent>
    </Marker>
  );
}

function slotLabel(slot: AgendaSlot, t: T): string | null {
  if (slot.kind === "choose") {
    return slot.name ? t("agenda.slotChoose", { name: slot.name }) : t("agenda.chooseOne");
  }
  return slot.name;
}

type Entry =
  | { kind: "slot"; at: string; slot: AgendaSlot }
  | { kind: "milestone"; at: string; milestone: Milestone };

function byDay(
  slots: Tuple<AgendaSlot>,
  milestones: Tuple<Milestone>,
  time: FormatOptions,
): Array<[string, Entry[]]> {
  const entries: Entry[] = [
    ...slots.map((slot): Entry => ({ kind: "slot", at: slot.startsAt, slot })),
    ...milestones.map((milestone): Entry => ({ kind: "milestone", at: milestone.at, milestone })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const days = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = formatDate(entry.at, time);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return [...days];
}

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const t = useT();
  const locale = useLocale();
  const time = useTimeFormat();
  return (
    <li className="grid gap-1 py-3 text-sm sm:grid-cols-[9rem_1fr] sm:gap-6">
      <span className="font-medium text-muted-fg tabular-nums">
        {formatTime(milestone.at, time)}
      </span>
      <span className="inline-flex items-center gap-2 text-muted-fg">
        <IconFlag className="size-4 shrink-0" />
        {milestoneLabel(milestone, t, locale)}
      </span>
    </li>
  );
}

export function AgendaView({
  agenda,
  milestones,
  kinds,
  eventId,
  slug,
  canPick,
}: {
  agenda: Agenda;
  milestones: Tuple<Milestone>;
  kinds: Tuple<SessionKind>;
  eventId: string;
  slug: string;
  canPick: boolean;
}) {
  const t = useT();
  const takesAttendance = useTakesAttendance();
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: agendaQueryOptions(eventId).queryKey });
  const choose = useMutation({
    mutationFn: async (sessionId: string) =>
      unwrap(await chooseSessionFn({ data: sessionId }).catch(requestFailure)),
    onSettled: refresh,
  });
  const leave = useMutation({
    mutationFn: async (slotId: string) =>
      unwrap(await leaveSlotFn({ data: slotId }).catch(requestFailure)),
    onSettled: refresh,
  });
  const time = useTimeFormat();
  const days = byDay(agenda.slots, milestones, time);
  const busy = choose.isPending || leave.isPending;

  return (
    <div className="flex flex-col gap-8">
      <ErrorAlert error={choose.error ?? leave.error} title={t("agenda.pickFailed")} />
      {days.map(([day, entries]) => (
        <section key={day} className="flex flex-col gap-3">
          {days.length > 1 && <h2 className="font-heading text-lg font-semibold">{day}</h2>}
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {entries.map((entry) => {
              if (entry.kind === "milestone") {
                return <MilestoneRow key={entry.milestone.key} milestone={entry.milestone} />;
              }
              const { slot } = entry;
              const picked = slot.sessions.find((session) => session.mine);
              const label = slotLabel(slot, t);
              return (
                <li
                  key={slot.id}
                  className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr] sm:gap-6"
                  aria-label={label ?? undefined}
                >
                  <div className="flex flex-col gap-0.5 text-sm">
                    <span className="font-medium tabular-nums">
                      {formatTimeRange(slot.startsAt, slot.endsAt, time)}
                    </span>
                    {label && <span className="text-muted-fg">{label}</span>}
                  </div>
                  <div className="flex flex-col gap-3">
                    {slot.sessions.map((session, index) => {
                      const mine = session.mine;
                      const full = seatsLeft(session) === 0;
                      return (
                        <Fragment key={session.id}>
                          {slot.kind === "choose" && index > 0 && <OrSeparator />}
                          <SessionCard
                            session={session}
                            slot={slot}
                            kinds={kinds}
                            slug={slug}
                            actions={
                              <>
                                {takesAttendance(session) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    nativeButton={false}
                                    render={
                                      <Link
                                        to="/events/$slug/agenda/$sessionId/attendance"
                                        params={{ slug, sessionId: session.id }}
                                      />
                                    }
                                  >
                                    {t("agenda.takeAttendance")}
                                  </Button>
                                )}
                                {slot.kind === "choose" && mine && (
                                  <Badge>
                                    <IconCheck />
                                    {t("agenda.yourPick")}
                                  </Badge>
                                )}
                                {slot.kind === "choose" &&
                                  canPick &&
                                  agenda.signupsOpen &&
                                  (mine ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={busy}
                                      onClick={() => leave.mutate(slot.id)}
                                    >
                                      {t("agenda.drop")}
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant={picked ? "outline" : "default"}
                                      disabled={busy || full}
                                      onClick={() => choose.mutate(session.id)}
                                    >
                                      {full
                                        ? t("agenda.full")
                                        : picked
                                          ? t("agenda.switch")
                                          : t("agenda.choose")}
                                    </Button>
                                  ))}
                              </>
                            }
                          />
                        </Fragment>
                      );
                    })}
                    {slot.kind === "choose" && canPick && !picked && !agenda.signupsOpen && (
                      <p className="text-sm text-muted-fg">{t("agenda.signupsClosed")}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function AgendaSummary({
  agenda,
  milestones,
  limit = 6,
}: {
  agenda: Agenda;
  milestones: Tuple<Milestone>;
  limit?: number;
}) {
  const t = useT();
  const locale = useLocale();
  const time = useTimeFormat();
  const now = useNow(60_000);
  const entries: Entry[] = [
    ...agenda.slots.map((slot): Entry => ({ kind: "slot", at: slot.startsAt, slot })),
    ...milestones.map((milestone): Entry => ({ kind: "milestone", at: milestone.at, milestone })),
  ]
    .filter((entry) => {
      if (now === null) return true;
      const end = entry.kind === "slot" ? (entry.slot.endsAt ?? entry.slot.startsAt) : entry.at;
      return new Date(end).getTime() >= now;
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, limit);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-fg">{t("agenda.nothingNext")}</p>;
  }

  return (
    <ul className="flex flex-col text-sm">
      {entries.map((entry) => {
        if (entry.kind === "milestone") {
          return (
            <li key={entry.milestone.key} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
              <span className="text-muted-fg tabular-nums">
                {dateParts(entry.at, time).weekday} {formatTime(entry.at, time)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted-fg">
                <IconFlag className="size-3.5 shrink-0" />
                {milestoneLabel(entry.milestone, t, locale)}
              </span>
            </li>
          );
        }
        const { slot } = entry;
        const picked = slot.sessions.find((session) => session.mine);
        const sessions = slot.kind === "choose" && picked ? [picked] : slot.sessions;
        return (
          <li key={slot.id} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
            <span className="text-muted-fg tabular-nums">
              {dateParts(slot.startsAt, time).weekday} {formatTime(slot.startsAt, time)}
            </span>
            <span>
              {slot.name && <span className="text-muted-fg">{slot.name}: </span>}
              {sessions.map((session, index) => (
                <Fragment key={session.id}>
                  {index > 0 && (
                    <span className="text-muted-fg">
                      {slot.kind === "choose" ? ` ${t("agenda.or")} ` : ", "}
                    </span>
                  )}
                  {session.name}
                  {session.required && <RequiredMark />}
                </Fragment>
              ))}
              {slot.kind === "choose" && picked && (
                <span className="text-muted-fg"> ({t("agenda.yourPickLower")})</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const checkInSchema = (t: T) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, t("agenda.enterCode"))
      .max(12)
      .meta({ label: t("agenda.codeLabel"), placeholder: t("agenda.codePlaceholder") }),
  });

export function CheckInForm({ eventId, code = "" }: { eventId: string; code?: string }) {
  const t = useT();
  const schema = useMemo(() => checkInSchema(t), [t]);
  const queryClient = useQueryClient();
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: { code },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await checkInFn({ data: { eventId, code: value.code } }).catch(requestFailure);
      if (!result.ok) return createValidationError({ fields: { code: result.error.message } });
      formApi.reset();
      setCheckedIn(result.data);
      await queryClient.invalidateQueries({ queryKey: agendaQueryOptions(eventId).queryKey });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <form.Field name="code">
          {(field) => (
            <field.Field className="flex-1">
              <field.Label className="sr-only" />
              <field.TextInput
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono uppercase"
              />
              <field.Error />
            </field.Field>
          )}
        </form.Field>
        <form.Submit pending={t("agenda.checkingIn")}>{t("agenda.checkIn")}</form.Submit>
      </form.Form>
      {checkedIn && (
        <p role="status" className="text-sm text-muted-fg">
          {t("agenda.checkedInTo", { session: checkedIn })}
        </p>
      )}
    </form.AppForm>
  );
}

/** Switches between a session's own pages: its main page and, for whoever takes attendance, attendance. */
export function SessionPages({ slug, session }: { slug: string; session: AgendaSession }) {
  const t = useT();
  const takesAttendance = useTakesAttendance();
  if (!session.hasPage || !takesAttendance(session)) return null;
  const params = { slug, sessionId: session.id };
  return (
    <nav aria-label={t("agenda.sessionPages")} className="flex gap-1 text-sm">
      <Link
        to="/events/$slug/agenda/$sessionId"
        params={params}
        activeOptions={{ exact: true }}
        className="rounded-md px-2.5 py-1 text-muted-fg no-underline hover:text-fg"
        activeProps={{ className: "bg-muted font-medium text-fg" }}
      >
        {t("agenda.mainPage")}
      </Link>
      <Link
        to="/events/$slug/agenda/$sessionId/attendance"
        params={params}
        className="rounded-md px-2.5 py-1 text-muted-fg no-underline hover:text-fg"
        activeProps={{ className: "bg-muted font-medium text-fg" }}
      >
        {t("agenda.attendance")}
      </Link>
    </nav>
  );
}
