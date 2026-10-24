import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  assignJudgesFn,
  judgingProgressQueryOptions,
  type JudgeProgress,
} from "@bogey/db/queries/judging";
import {
  eventConflictsQueryOptions,
  eventPinsQueryOptions,
  judgeCalibrationQueryOptions,
} from "@bogey/db/queries/conflicts";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import { eventFlagsQueryOptions, type JudgingFlag } from "@bogey/db/queries/deliberation";
import { flagReason } from "#/components/event/judging/deliberation.tsx";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { judgingRoundsQueryOptions } from "@bogey/db/queries/judging";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { Screen } from "@bogey/ui/components/screen";
import { IconClipboardCheck, IconGavel, IconHourglass } from "@tabler/icons-react";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { Calibration, ManualAssignments } from "../-components/fairness.tsx";
import { AssignmentRules, assignmentQueries } from "../-components/assignment-rules.tsx";
import { Rounds } from "../-components/rounds.tsx";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging/")({
  staticData: {
    title: msg("judging.title"),
    settings: (t) => [
      searchSection(t("manageJudging.see"), { id: "what-judges-see" }),
      ...searchSettings("judging", ["blind", "browseProjects", "judgeExport"], t),
      searchSection(t("manageJudging.rounds"), {
        keywords: ["live demos", "presentations", "offline", "in person"],
        id: "rounds",
      }),
      searchSection(t("manageJudging.progress"), {
        keywords: ["assign judges", "judging rules", "tags", "adult judge", "student judge"],
        id: "progress",
      }),
      searchSection(t("manualAssign.title"), {
        keywords: ["conflict of interest", "conflicts", "pin", "pinned judges", "specific judge"],
        id: "manual-assignments",
      }),
      searchSection(t("deliberation.title"), {
        keywords: ["flag", "flagged", "deliberation", "disagreement"],
        id: "deliberation",
      }),
      ...searchSettings("judging", ["deliberation", "flagGap", "holdFlagged"], t),
      searchSection(t("manageJudging.howScore"), {
        keywords: ["calibration"],
        id: "how-judges-score",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({ ...eventFlagsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...judgingProgressQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({ ...judgingRoundsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventConflictsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventPinsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...judgeCalibrationQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({ ...eventTeamsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...submissionFormsQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({ ...assignmentQueries(context.event).settings, staleTime: "static" }),
      context.query.query({ ...assignmentQueries(context.event).tags, staleTime: "static" }),
      context.query.query({ ...eventWindowsQueryOptions(context.event.id), staleTime: "static" }),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "judging",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  return (
    <Screen title={t("judging.title")} description={t("manageJudging.intro")} width="embedded">
      <Progress />
      <Screen.Section id="what-judges-see" title={t("manageJudging.see")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="judging"
          keys={["blind", "browseProjects", "judgeExport"]}
        />
      </Screen.Section>
      <Rounds />
      <ManualAssignments eventId={event.id} />
      <Deliberation />
      <Calibration eventId={event.id} />
      <PluginSettingSections page="judging" />
    </Screen>
  );
}

function Progress() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: progress } = useSuspenseQuery(judgingProgressQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(assignmentQueries(event).settings);
  const assign = useMutation({
    mutationFn: async () =>
      unwrap(
        await assignJudgesFn({
          data: { eventId: event.id, perSubmission: settings.judging.assignment.perProject },
        }),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: judgingProgressQueryOptions(event.id).queryKey }),
  });
  const done = progress.judges.reduce((sum, judge) => sum + judge.done, 0);
  const total = progress.judges.reduce((sum, judge) => sum + judge.assigned, 0);

  return (
    <Screen.Section id="progress" title={t("manageJudging.progress")}>
      <StatGroup>
        <Stat icon={IconGavel} label={t("overview.judges")} value={progress.judges.length} />
        <Stat icon={IconClipboardCheck} label={t("manageJudging.doneOf", { total })} value={done} />
        <Stat icon={IconHourglass} label={t("manageJudging.noScores")} value={progress.unscored} />
      </StatGroup>

      <AssignmentRules event={event} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={progress.submissions === 0 || assign.isPending}
          onClick={() => assign.mutate()}
        >
          {assign.isPending ? `${t("manageJudging.assigning")}...` : t("manageJudging.assign")}
        </Button>
        {assign.isSuccess && (
          <span className="text-sm text-muted-fg" role="status">
            {t("manageJudging.newAssignments", { count: assign.data })}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-fg">
        {t("manageJudging.spreads", { count: progress.submissions })}
      </p>
      <ErrorAlert error={assign.error} title={t("manageJudging.assignFailed")} />

      {progress.judges.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageJudging.noJudges")}</p>
      ) : (
        <JudgeTable judges={progress.judges} />
      )}
    </Screen.Section>
  );
}

function Deliberation() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: flags } = useSuspenseQuery(eventFlagsQueryOptions(event.id));
  return (
    <Screen.Section
      id="deliberation"
      title={t("deliberation.title")}
      description={t("deliberation.manageHelp")}
    >
      <SettingFields
        scope={{ scope: "event", eventId: event.id }}
        namespace="judging"
        keys={["deliberation", "flagGap", "holdFlagged"]}
      />
      {flags.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("deliberation.none")}</p>
      ) : (
        <FlagTable flags={flags} slug={event.slug} />
      )}
    </Screen.Section>
  );
}

const judgeColumn = dataColumns<JudgeProgress>();

function judgeColumns(t: T) {
  return judgeColumn.columns([
    judgeColumn.accessor("name", {
      header: t("checkin.name"),
      enableHiding: false,
      cell: (info) => (
        <span className="flex items-center gap-2 font-medium">
          <NameAvatar name={info.getValue()} />
          {info.getValue()}
        </span>
      ),
    }),
    judgeColumn.accessor("assigned", { header: t("manageJudging.assignedColumn") }),
    judgeColumn.accessor("done", {
      header: t("judging.done"),
      cell: (info) => (
        <span>
          {info.getValue()}
          {info.row.original.extra > 0 && (
            <span className="ml-1 text-muted-fg">
              ({t("manageJudging.extraDone", { count: info.row.original.extra })})
            </span>
          )}
        </span>
      ),
    }),
    judgeColumn.accessor("scored", { header: t("manageJudging.scoredColumn") }),
  ]);
}

const judgeSearch = { text: (judge: JudgeProgress) => judge.name };

function JudgeTable({ judges }: { judges: JudgeProgress[] }) {
  const t = useT();
  const columns = useMemo(() => judgeColumns(t), [t]);
  return (
    <DataTable
      columns={columns}
      data={judges}
      getRowId={(judge) => judge.userId}
      search={judgeSearch}
      pageSize={25}
    />
  );
}

const flagColumn = dataColumns<JudgingFlag>();

function flagText(flag: JudgingFlag, t: T): string {
  return [
    flagReason(flag, t),
    ...(flag.resolvedAt
      ? [
          flag.resolvedBy
            ? t("deliberation.resolvedBy", { name: flag.resolvedBy })
            : t("deliberation.resolvedPlain"),
        ]
      : []),
  ].join(" · ");
}

function FlagTable({ flags, slug }: { flags: JudgingFlag[]; slug: string }) {
  const t = useT();
  const columns = useMemo(
    () =>
      flagColumn.columns([
        flagColumn.accessor("title", {
          header: t("tables.project"),
          enableHiding: false,
          cell: (info) => (
            <Link
              to="/events/$slug/judging/$submissionId"
              params={{ slug, submissionId: info.row.original.submissionId }}
              className="link font-medium"
            >
              {info.getValue()}
            </Link>
          ),
        }),
        flagColumn.accessor(
          (flag) => (flag.resolvedAt ? t("deliberation.resolved") : t("deliberation.open")),
          {
            id: "status",
            header: t("projectExport.field.status"),
            cell: (info) => (
              <span className="flex items-center gap-2">
                <StatusDot
                  tone={info.row.original.resolvedAt ? "done" : "attention"}
                  label={info.getValue()}
                />
                {info.getValue()}
              </span>
            ),
          },
        ),
        flagColumn.accessor((flag) => flagText(flag, t), {
          id: "reason",
          header: t("audit.details"),
          cell: (info) => <span className="text-muted-fg">{info.getValue()}</span>,
        }),
      ]),
    [t, slug],
  );
  const search = useMemo(
    () => ({ text: (flag: JudgingFlag) => `${flag.title} ${flagText(flag, t)}` }),
    [t],
  );
  return (
    <DataTable
      columns={columns}
      data={flags}
      getRowId={(flag) => flag.id}
      search={search}
      pageSize={25}
    />
  );
}
