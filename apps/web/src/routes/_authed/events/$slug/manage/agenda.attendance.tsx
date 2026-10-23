import { createFileRoute, Link } from "@tanstack/react-router";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@bogey/ui/components/empty";
import { exportHref } from "#/lib/exports.ts";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { IconDownload } from "@tabler/icons-react";
import { agendaQueryOptions, attendanceQueryOptions } from "@bogey/db/queries/sessions";
import { formatTimeRange } from "@bogey/utils/time";
import { Button } from "@bogey/ui/components/button";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
import { msg, useT } from "#/lib/translate.tsx";

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
                      to="/events/$slug/agenda/$sessionId/attendance"
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

export const Route = createFileRoute("/_authed/events/$slug/manage/agenda/attendance")({
  staticData: {
    title: msg("manageAgenda.attendance"),
    settings: (t) => [
      searchSection(t("manageAgenda.attendance"), {
        keywords: ["check-in", "codes"],
        id: "attendance",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(agendaQueryOptions(context.event.id)),
      context.query.ensureQueryData(attendanceQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const any = agenda.slots.some((slot) => slot.sessions.some((session) => session.takesAttendance));
  return (
    <Screen title={t("manageAgenda.attendance")} width="embedded">
      {any ? (
        <Attendance />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("manageAgenda.noAttendanceTitle")}</EmptyTitle>
            <EmptyDescription>{t("manageAgenda.noAttendanceBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Screen>
  );
}
