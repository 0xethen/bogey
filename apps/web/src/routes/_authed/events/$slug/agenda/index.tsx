import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { Screen } from "@bogey/ui/components/screen";
import { AgendaView, hasRequired, RequiredNote } from "#/components/event/agenda/agenda.tsx";
import { participates, useEventViewer } from "#/lib/viewer.ts";
import { agendaMilestones } from "#/lib/windows.ts";
import { sessionKindsWithPlugins } from "#/lib/plugins.ts";
import { useT } from "#/lib/translate.tsx";

const agendaSettings = (eventId: string) =>
  settingsQueryOptions({ eventId }, ["agenda", "schedule"]);

export const Route = createFileRoute("/_authed/events/$slug/agenda/")({
  loader: ({ context }) =>
    Promise.all([
      context.query.query({ ...agendaSettings(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventWindowsQueryOptions(context.event.id), staleTime: "static" }),
    ]),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, plugins } = Route.useRouteContext();
  const viewer = useEventViewer();
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(agendaSettings(event.id));
  const milestones = agendaMilestones(windows, settings.schedule);
  const participant = viewer ? participates(viewer) : false;
  const choosing = agenda.slots.some((slot) => slot.kind === "choose");
  const checksIn =
    participant && agenda.slots.some((slot) => slot.sessions.some((s) => s.takesAttendance));
  const picking = participant && choosing && agenda.signupsOpen;
  const required = hasRequired(agenda);

  return (
    <Screen
      title={t("eventTab.agenda")}
      description={
        picking || required ? (
          <>
            {picking && `${t("agenda.pick")} `}
            {required && <RequiredNote />}
          </>
        ) : undefined
      }
    >
      {checksIn && <p className="text-sm text-muted-fg">{t("agenda.checkInOnPage")}</p>}
      {agenda.slots.length === 0 && milestones.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("agenda.empty")}</p>
      ) : (
        <AgendaView
          agenda={agenda}
          milestones={milestones}
          kinds={sessionKindsWithPlugins(settings.agenda.kinds, plugins)}
          eventId={event.id}
          slug={event.slug}
          canPick={participant}
        />
      )}
    </Screen>
  );
}
