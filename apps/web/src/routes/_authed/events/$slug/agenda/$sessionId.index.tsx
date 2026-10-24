import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconCircleCheck, IconPencil } from "@tabler/icons-react";
import { useCan } from "@bogey/db/permissions";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { Button } from "@bogey/ui/components/button";
import { Markdown } from "@bogey/ui/components/markdown";
import { Screen } from "@bogey/ui/components/screen";
import { CheckInForm, SessionCard, SessionPages } from "#/components/event/agenda/agenda.tsx";
import { sessionKindsWithPlugins } from "#/lib/plugins.ts";
import { participates, useEventViewer } from "#/lib/viewer.ts";
import { useT } from "#/lib/translate.tsx";
import { useTakesAttendance } from "#/lib/attendance.ts";

const agendaSettings = (eventId: string) => settingsQueryOptions({ eventId }, ["agenda"]);

export const Route = createFileRoute("/_authed/events/$slug/agenda/$sessionId/")({
  // the room's QR code opens this page with its code filled in
  validateSearch: z.object({ code: z.string().max(12).optional() }),
  loader: async ({ context, params }) => {
    const [agenda] = await Promise.all([
      context.query.ensureQueryData(agendaQueryOptions(context.event.id)),
      context.query.ensureQueryData(agendaSettings(context.event.id)),
    ]);
    const session = agenda.slots
      .flatMap((slot) => slot.sessions)
      .find((entry) => entry.id === params.sessionId);
    if (!session?.hasPage) throw notFound();
    return { title: session.name };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, plugins } = Route.useRouteContext();
  const { sessionId } = Route.useParams();
  const { code } = Route.useSearch();
  const viewer = useEventViewer();
  const takesAttendance = useTakesAttendance();
  const manages = useCan("event.manage");
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(agendaSettings(event.id));
  const slot = agenda.slots.find((entry) => entry.sessions.some((s) => s.id === sessionId));
  const session = slot?.sessions.find((entry) => entry.id === sessionId);
  if (!slot || !session) return null;
  const participant = viewer ? participates(viewer) : false;

  return (
    <Screen
      title={session.name}
      width="narrow"
      actions={
        (takesAttendance(session) || manages) && (
          <div className="flex items-center gap-1">
            {takesAttendance(session) && (
              <Button
                size="sm"
                variant="outline"
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
            {manages && (
              <Button
                size="icon-sm"
                variant="ghost"
                nativeButton={false}
                aria-label={t("agenda.editSession")}
                tooltip={t("agenda.editSession")}
                render={
                  <Link
                    to="/events/$slug/manage/agenda/sessions"
                    params={{ slug: event.slug }}
                    search={{ session: session.id }}
                    hash="sessions"
                  />
                }
              >
                <IconPencil />
              </Button>
            )}
          </div>
        )
      }
    >
      <SessionPages slug={event.slug} session={session} />
      <SessionCard
        session={session}
        named={false}
        slot={slot}
        kinds={sessionKindsWithPlugins(settings.agenda.kinds, plugins)}
      />
      {session.pageMd.trim() && <Markdown>{session.pageMd}</Markdown>}
      {session.takesAttendance && participant && (
        <Screen.Section
          id="check-in"
          title={t("agenda.checkIn")}
          description={session.attended ? undefined : t("agenda.checkInHelp")}
        >
          {session.attended ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <IconCircleCheck className="size-4" />
              {t("agenda.checkedInTo", { session: session.name })}
            </p>
          ) : (
            <CheckInForm eventId={event.id} code={code} />
          )}
        </Screen.Section>
      )}
    </Screen>
  );
}
