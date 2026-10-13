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
  type JudgeQueueItem,
} from "@bogey/db/queries/judging";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { DisclosureList } from "@bogey/ui/components/disclosure-row";
import { LinkRow } from "@bogey/ui/components/link-row";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { Screen } from "@bogey/ui/components/screen";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { IconInfoCircle } from "@tabler/icons-react";
import { msg, useT } from "#/lib/translate.tsx";

const ALL = "all";

export const Route = createFileRoute("/_authed/events/$slug/judging/")({
  staticData: { title: msg("judging.title") },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(judgeQueueQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: queue } = useSuspenseQuery(judgeQueueQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: roundData } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const windowOf = (item: JudgeQueueItem) =>
    roundData.rounds.find((round) => round.id === item.roundId)?.windowKey ?? "judging";
  const open =
    queue.length === 0
      ? isWindowOpen(windowByKey(windows, "judging"))
      : queue.some((item) => isWindowOpen(windowByKey(windows, windowOf(item))));
  const { data: prizes = [] } = useQuery(eventPrizesQueryOptions(event.id));
  const [track, setTrack] = useState(ALL);
  const visible = track === ALL ? queue : queue.filter((item) => item.trackIds.includes(track));
  const assigned = visible.filter((item) => item.assigned);
  const others = visible.filter((item) => !item.assigned);
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
  const next =
    assigned.find((item) => item.status !== "done" && item.status !== "skipped") ??
    others.find((item) => item.scored === 0);

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
          title={item.title}
          meta={[
            ...(item.table ? [t("judging.table", { table: item.table })] : []),
            item.teamName,
            item.formTitle,
            ...(item.roundOrdinal > 1 ? [item.roundName] : []),
            ...item.trackIds.flatMap((id) => prizeNames.get(id) ?? []),
            ...(item.status === "skipped" ? [t("judging.skipped")] : []),
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
    >
      {!open && (
        <Alert>
          <IconInfoCircle />
          <AlertTitle>{t("judging.closedTitle")}</AlertTitle>
          <AlertDescription>{t("judging.closedBody")}</AlertDescription>
        </Alert>
      )}
      {next && (
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
      <ErrorAlert error={skip.error} title={t("judging.updateFailed")} />
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
      {assigned.length > 0 && (
        <Screen.Section id="assigned-to-you" title={t("judging.assigned")}>
          <DisclosureList className="border-y-0">{assigned.map(row)}</DisclosureList>
        </Screen.Section>
      )}
      {others.length > 0 && (
        <Screen.Section
          id="everything-else"
          title={assigned.length ? t("judging.everythingElse") : t("judging.projects")}
          description={assigned.length ? t("judging.scoreThemToo") : undefined}
        >
          <DisclosureList className="border-y-0">{others.map(row)}</DisclosureList>
        </Screen.Section>
      )}
    </Screen>
  );
}
