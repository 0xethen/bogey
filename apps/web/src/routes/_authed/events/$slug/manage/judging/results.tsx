import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconDownload } from "@tabler/icons-react";
import {
  groupResults,
  judgingRoundsQueryOptions,
  previewResultsQueryOptions,
  publishResultsFn,
  type ResultRow,
} from "@bogey/db/queries/judging";
import { eventFlagsQueryOptions } from "@bogey/db/queries/deliberation";
import { voteCountsQueryOptions } from "@bogey/db/queries/votes";
import { draftAwardsQueryOptions } from "@bogey/db/queries/awards";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { eventEntriesQueryOptions, eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { offlineScoresQueryOptions } from "@bogey/db/queries/demos";
import { eventSubmissionsQueryOptions } from "@bogey/db/queries/submissions";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { unwrap } from "@bogey/db/errors";
import { pluginRankingMethods } from "@bogey/plugins";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { exportHref } from "#/lib/exports.ts";
import { ProjectExport } from "#/components/event/project-export.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { AwardsEditor } from "../-components/awards-editor.tsx";
import { OfflineScores } from "../-components/offline-scores.tsx";

const OFFLINE = "offline";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging/results")({
  staticData: {
    title: msg("manageNav.results"),
    settings: (t) => [
      searchSection(t("offlineScores.title"), {
        keywords: ["offline", "paper", "enter scores"],
        id: "offline-scores",
      }),
      searchSection(t("manageJudging.publishing"), { id: "publishing" }),
      ...searchSettings("judging", ["normalize", "minJudges", "showRankings", "shareWithTeams"], t),
      searchSection(t("manageJudging.vote"), {
        keywords: ["people's choice", "voting"],
        id: "popular-vote",
      }),
      ...searchSettings("voting", ["enabled", "who", "votesPerPerson", "ownTeam", "showCounts"], t),
      searchSection(t("results.awards"), { keywords: ["winners", "places"], id: "awards" }),
      searchSection(t("results.title"), { keywords: ["ranking", "publish"], id: "results" }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(previewResultsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventFlagsQueryOptions(context.event.id)),
      context.query.ensureQueryData(draftAwardsQueryOptions(context.event.id)),
      context.query.ensureQueryData(voteCountsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPrizesQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventEntriesQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      context.query.ensureQueryData(offlineScoresQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventSubmissionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(
        settingsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }, [
          "judging",
        ]),
      ),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "judging",
        "voting",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: rows } = useSuspenseQuery(previewResultsQueryOptions(event.id));
  return (
    <Screen title={t("manageNav.results")} description={t("manageResults.intro")} width="embedded">
      <OfflineScores eventId={event.id} />
      <Screen.Section id="publishing" title={t("manageJudging.publishing")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="judging"
          keys={["normalize", "minJudges", "showRankings", "shareWithTeams"]}
        />
      </Screen.Section>
      <Screen.Section
        id="popular-vote"
        title={t("manageJudging.vote")}
        description={t("manageJudging.voteHelp")}
        actions={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "votes")} download />}
          >
            <IconDownload />
            {t("manageJudging.voteCounts")}
          </Button>
        }
      >
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="voting"
          keys={["enabled", "who", "votesPerPerson", "ownTeam", "showCounts"]}
        />
      </Screen.Section>
      <AwardsEditor eventId={event.id} rows={rows} />
      <Results />
    </Screen>
  );
}

function Results() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: rows } = useSuspenseQuery(previewResultsQueryOptions(event.id));
  const { data: flags } = useSuspenseQuery(eventFlagsQueryOptions(event.id));
  const [published, setPublished] = useState<string | null>(null);
  const publish = useMutation({
    mutationFn: async () => unwrap(await publishResultsFn({ data: event.id })),
    onSuccess: async (at) => {
      setPublished(at);
      await queryClient.invalidateQueries({ queryKey: ["results", event.id] });
    },
  });

  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ orgId: event.org_id, eventId: event.id }, ["judging"]),
  );
  const groups = groupResults(rows);
  const evened = settings.judging.normalize !== "none";
  const minJudges = settings.judging.minJudges ?? 1;
  const thin = rows.filter((row) => row.method === "rubric" && row.judges < minJudges);
  const openFlags = flags.filter((flag) => !flag.resolvedAt).length;

  return (
    <Screen.Section
      id="results"
      title={t("results.title")}
      description={t("manageJudging.resultsHelp")}
      actions={
        <>
          <ProjectExport
            event={event}
            trigger={
              <Button size="sm" variant="outline">
                <IconDownload />
                {t("projectExport.button")}
              </Button>
            }
          />
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "results")} download />}
          >
            <IconDownload />
            {t("results.title")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "scores")} download />}
          >
            <IconDownload />
            {t("manageJudging.scores")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "awards")} download />}
          >
            <IconDownload />
            {t("results.awards")}
          </Button>
          <Button
            size="sm"
            disabled={publish.isPending || rows.length === 0}
            onClick={() => {
              queryClient.invalidateQueries({
                queryKey: previewResultsQueryOptions(event.id).queryKey,
              });
              publish.mutate();
            }}
          >
            {publish.isPending ? t("manageJudging.publishing2") : t("manageJudging.publish")}
          </Button>
        </>
      }
    >
      <ErrorAlert error={publish.error} title={t("manageJudging.publishFailed")} />
      {openFlags > 0 && (
        <Alert>
          <IconAlertTriangle />
          <AlertTitle>{t("deliberation.openCount", { count: openFlags })}</AlertTitle>
          <AlertDescription>
            {settings.judging.holdFlagged === false
              ? t("deliberation.publishAnyway")
              : t("deliberation.publishHeld")}
          </AlertDescription>
        </Alert>
      )}
      {thin.length > 0 && (
        <Alert>
          <IconAlertTriangle />
          <AlertTitle>{t("manageJudging.thin", { count: thin.length, min: minJudges })}</AlertTitle>
          <AlertDescription>{t("manageJudging.thinHelp")}</AlertDescription>
        </Alert>
      )}
      {published && (
        <p role="status" className="text-sm text-muted-fg">
          {t("manageJudging.published")}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageJudging.nothingToRank")}</p>
      ) : (
        groups.map(({ title: formTitle, rows: formRows }) => (
          <div key={formTitle} className="flex flex-col gap-2">
            {groups.length > 1 && <h4 className="text-sm font-medium">{formTitle}</h4>}
            <ResultsTable
              label={t("results.rankingOf", { form: formTitle })}
              rows={formRows}
              evened={evened}
            />
          </div>
        ))
      )}
    </Screen.Section>
  );
}

const column = dataColumns<ResultRow>();

function ResultsTable({
  label,
  rows,
  evened,
}: {
  label: string;
  rows: ResultRow[];
  evened: boolean;
}) {
  const t = useT();
  const { plugins } = Route.useRouteContext();
  const methodLabel = useMemo(() => {
    const methods = pluginRankingMethods(plugins);
    return (id: string) =>
      id === OFFLINE ? t("rounds.offline") : (methods.find((each) => each.id === id)?.label ?? id);
  }, [plugins, t]);
  const columns = useMemo(() => {
    const detail = (row: ResultRow) =>
      [
        row.rubric,
        row.method === "rubric"
          ? t("manageJudging.judgeCount", { count: row.judges })
          : methodLabel(row.method),
        evened && row.method === "rubric" && row.rawScore !== null
          ? t("manageJudging.raw", { score: row.rawScore })
          : null,
        row.conflicted > 0 ? t("manageJudging.leftOut", { count: row.conflicted }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
    return column.columns([
      column.accessor("rank", {
        header: t("projectExport.field.rank"),
        enableHiding: false,
        cell: (info) => <span className="font-semibold tabular-nums">{info.getValue()}</span>,
      }),
      column.accessor("title", { header: t("tables.project"), enableHiding: false }),
      column.accessor("teamName", { header: t("tables.team") }),
      column.accessor((row) => row.score ?? -1, {
        id: "score",
        header: t("projectExport.field.score"),
        cell: (info) => <span className="tabular-nums">{info.row.original.score ?? "–"}</span>,
      }),
      column.display({
        id: "detail",
        header: t("audit.details"),
        cell: (info) => <span className="text-muted-fg">{detail(info.row.original)}</span>,
      }),
    ]);
  }, [t, evened, methodLabel]);
  return (
    <div role="region" aria-label={label}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.submissionId}
        search={searchResults}
        pageSize={25}
      />
    </div>
  );
}

const searchResults = { text: (row: ResultRow) => `${row.title} ${row.teamName}` };
