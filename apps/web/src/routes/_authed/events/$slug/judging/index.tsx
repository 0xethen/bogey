import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { skipSubmissionFn } from "@bogey/db/queries/expo";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { OptSelect } from "@bogey/ui/components/opt-select";
import {
  judgeQueueQueryOptions,
  judgingRoundsQueryOptions,
  projectExportAccessQueryOptions,
  type JudgeQueueItem,
} from "@bogey/db/queries/judging";
import { ProjectExport } from "#/components/event/project-export.tsx";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { LinkRow, RowList } from "@bogey/ui/components/row";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { Screen } from "@bogey/ui/components/screen";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { IconDownload, IconInfoCircle } from "@tabler/icons-react";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { setPanelNowFn } from "@bogey/db/queries/demos";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { formatTime } from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { IconPlayerPlay, IconPresentation } from "@tabler/icons-react";
import { useViewerTimeFormat } from "#/lib/time.ts";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import {
  afterSteps,
  browsable,
  judgingProgress,
  judgingSteps,
  type JudgingStep,
} from "@bogey/db/queries/judging-flow";
import { IconCircleCheck, IconMessages, IconLayoutGrid } from "@tabler/icons-react";

const ALL = "all";

export const Route = createFileRoute("/_authed/events/$slug/judging/")({
  staticData: { title: msg("judging.title") },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(judgeQueueQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["judging"]),
      ),
    ]),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: queue } = useSuspenseQuery(judgeQueueQueryOptions(event.id));
  // a demo panel's presenter moves along live
  useLiveInvalidate("judging_panels", judgeQueueQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });
  const time = useViewerTimeFormat();
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: roundData } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const windowOf = (item: JudgeQueueItem) =>
    roundData.rounds.find((round) => round.id === item.roundId)?.windowKey ?? "judging";
  const open =
    queue.length === 0
      ? isWindowOpen(windowByKey(windows, "judging"))
      : queue.some((item) => isWindowOpen(windowByKey(windows, windowOf(item))));
  const { data: prizes = [] } = useQuery(eventPrizesQueryOptions(event.id));
  const { data: exportAccess = "off" } = useQuery(projectExportAccessQueryOptions(event.id));
  const [track, setTrack] = useState(ALL);
  const visible = track === ALL ? queue : queue.filter((item) => item.trackIds.includes(track));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["judging"]),
  );
  const flow = {
    queue,
    deliberation: settings.judging.deliberation,
    browseProjects: settings.judging.browseProjects,
  };
  const steps = judgingSteps(flow);
  const progress = judgingProgress(steps);
  const hasAssignments = queue.some((item) => item.assigned);
  const browse = new Set(browsable(flow).map((item) => item.submissionId));
  const assigned = visible.filter((item) => item.assigned);
  // judges with assignments see other projects only when organizers allow it
  const others = visible.filter(
    (item) => !item.assigned && (!hasAssignments || browse.has(item.submissionId)),
  );
  const prizeNames = new Map(prizes.map((prize) => [prize.id, prize.name]));
  const done = assigned.filter((item) => item.status === "done").length;

  const queryClient = useQueryClient();
  const skip = useMutation({
    mutationFn: async (item: JudgeQueueItem) =>
      unwrap(
        await skipSubmissionFn({
          data: { submissionId: item.submissionId, skipped: item.status !== "skipped" },
        }),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(event.id).queryKey }),
  });
  const presenting = (item: JudgeQueueItem) =>
    item.demo !== null && item.demo.nowPosition === item.demo.position;
  const next =
    assigned.find((item) => presenting(item) && item.status !== "done") ??
    assigned.find((item) => item.status !== "done" && item.status !== "skipped") ??
    others.find((item) => item.scored === 0);
  // the panels this judge sits on, for the run of show
  const panels = [
    ...new Map(
      assigned.flatMap((item) => (item.demo ? [[item.demo.panelId, item.demo] as const] : [])),
    ).values(),
  ];
  // one past the last slot this judge hears; a team they conflict with may sit in between
  const panelSize = (panelId: string) =>
    Math.max(
      0,
      ...assigned.flatMap((item) =>
        item.demo?.panelId === panelId ? [item.demo.position + 1] : [],
      ),
    );
  const advance = useMutation({
    mutationFn: async (input: { panelId: string; position: number }) =>
      unwrap(await setPanelNowFn({ data: input })),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(event.id).queryKey }),
  });

  const row = (item: JudgeQueueItem) => (
    <div key={item.submissionId} className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <LinkRow
          render={
            <Link
              to="/events/$slug/judging/$submissionId"
              params={{ slug: event.slug, submissionId: item.submissionId }}
            />
          }
          leading={
            <StatusDot
              tone={item.status === "done" ? "done" : item.scored > 0 ? "attention" : "idle"}
              label={
                item.status === "done"
                  ? t("judging.done")
                  : item.scored > 0
                    ? t("judging.started")
                    : t("judging.notStarted")
              }
            />
          }
          title={
            <>
              {item.title}
              {presenting(item) && <Badge className="ml-2">{t("demos.presenting")}</Badge>}
            </>
          }
          meta={[
            ...(item.demo?.startsAt
              ? [formatTime(item.demo.startsAt, { ...time, timeZone: event.timezone })]
              : []),
            ...(item.table ? [t("judging.table", { table: item.table })] : []),
            item.teamName,
            item.formTitle,
            ...(item.roundOrdinal > 1 ? [item.roundName] : []),
            ...item.trackIds.flatMap((id) => prizeNames.get(id) ?? []),
            ...(item.status === "skipped" ? [t("judging.skipped")] : []),
            ...(item.flagged ? [t("deliberation.flagged")] : []),
          ].join(" · ")}
        />
      </div>
      {open && item.status !== "done" && (
        <Button
          size="xs"
          variant="ghost"
          disabled={skip.isPending}
          onClick={() => skip.mutate(item)}
        >
          {item.status === "skipped" ? t("judging.restore") : t("judging.absent")}
        </Button>
      )}
    </div>
  );

  return (
    <Screen
      title={t("judging.title")}
      description={assigned.length ? t("judging.progress", { done, total: assigned.length }) : ""}
      width="narrow"
      actions={
        exportAccess !== "off" && (
          <ProjectExport
            event={event}
            trigger={
              <Button size="sm" variant="outline">
                <IconDownload />
                {t("projectExport.judgeButton")}
              </Button>
            }
          />
        )
      }
    >
      {!open && (
        <Alert>
          <IconInfoCircle />
          <AlertTitle>{t("judging.closedTitle")}</AlertTitle>
          <AlertDescription>{t("judging.closedBody")}</AlertDescription>
        </Alert>
      )}
      {progress.finished && <Finished steps={steps} />}
      {next && !progress.finished && (
        <div>
          <Button
            nativeButton={false}
            render={
              <Link
                to="/events/$slug/judging/$submissionId"
                params={{ slug: event.slug, submissionId: next.submissionId }}
              />
            }
          >
            {next.table
              ? t("judging.nextTable", { table: next.table })
              : t("judging.nextTitle", { title: next.title })}
          </Button>
        </div>
      )}
      {panels.map((panel) => (
        <div
          key={panel.panelId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/50 p-3"
        >
          <span className="text-sm">
            <span className="font-medium">{panel.panelName}</span>
            {panel.location && <span className="text-muted-fg"> · {panel.location}</span>}
          </span>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              tooltip={t("present.openHelp")}
              render={
                <Link
                  to="/events/$slug/demos/$panelId"
                  params={{ slug: event.slug, panelId: panel.panelId }}
                />
              }
              nativeButton={false}
            >
              <IconPresentation />
              {t("present.open")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advance.isPending || (panel.nowPosition ?? -1) >= panelSize(panel.panelId)}
              onClick={() =>
                advance.mutate({
                  panelId: panel.panelId,
                  position: panel.nowPosition === null ? 0 : panel.nowPosition + 1,
                })
              }
            >
              <IconPlayerPlay />
              {panel.nowPosition === null ? t("demos.start") : t("demos.next")}
            </Button>
          </span>
        </div>
      ))}
      <ErrorAlert error={skip.error ?? advance.error} title={t("judging.updateFailed")} />
      {prizes.length > 0 && queue.length > 0 && (
        <OptSelect
          id="track-filter"
          value={track}
          onChange={setTrack}
          options={[
            { value: ALL, label: t("judging.everyPrize") },
            ...prizes.map((prize) => ({ value: prize.id, label: prize.name })),
          ]}
        />
      )}
      {queue.length === 0 && <p className="text-sm text-muted-fg">{t("judging.empty")}</p>}
      {queue.some((item) => item.flagged) && (
        <Screen.Section
          id="deliberation"
          title={t("deliberation.title")}
          description={t("deliberation.queueHelp")}
        >
          <RowList variant="flush">{queue.filter((item) => item.flagged).map(row)}</RowList>
        </Screen.Section>
      )}
      {assigned.length > 0 && (
        <Screen.Section id="assigned-to-you" title={t("judging.assigned")}>
          <RowList variant="flush">{assigned.map(row)}</RowList>
        </Screen.Section>
      )}
      {others.length > 0 && (
        <Screen.Section
          id="everything-else"
          title={assigned.length ? t("judging.everythingElse") : t("judging.projects")}
          description={assigned.length ? t("judging.scoreThemToo") : undefined}
        >
          <RowList variant="flush">{others.map(row)}</RowList>
        </Screen.Section>
      )}
    </Screen>
  );
}

// how each step after the queue is offered
const afterCopy = (t: T, step: JudgingStep) =>
  step.kind === "deliberate"
    ? {
        icon: IconMessages,
        title: t("judging.after.deliberate"),
        help: t("judging.after.deliberateHelp", { count: step.count }),
        hash: undefined,
      }
    : {
        icon: IconLayoutGrid,
        title: t("judging.after.browse"),
        help: t("judging.after.browseHelp", { count: step.count }),
        hash: "everything-else",
      };

/** Shown once a judge's queue is done: what they can do next. */
function Finished({ steps }: { steps: readonly JudgingStep[] }) {
  const t = useT();
  const { event } = Route.useRouteContext();
  const after = afterSteps(steps).map((step) => ({ step, ...afterCopy(t, step) }));
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-5">
      <div className="flex items-start gap-3">
        <IconCircleCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">{t("judging.finishedTitle")}</h2>
          <p className="text-sm text-muted-fg">{t("judging.finishedBody")}</p>
        </div>
      </div>
      {after.length ? (
        <RowList>
          {after.map(({ step, icon: Icon, title, help, hash }) => (
            <LinkRow
              key={step.kind}
              render={
                hash ? (
                  <Link to="/events/$slug/judging" params={{ slug: event.slug }} hash={hash} />
                ) : (
                  <Link
                    to="/events/$slug/judging/$submissionId"
                    params={{ slug: event.slug, submissionId: step.submissionId! }}
                  />
                )
              }
              leading={<Icon className="size-4 text-muted-fg" />}
              title={title}
              meta={help}
            />
          ))}
        </RowList>
      ) : (
        <p className="text-sm text-muted-fg">{t("judging.after.none")}</p>
      )}
    </div>
  );
}
