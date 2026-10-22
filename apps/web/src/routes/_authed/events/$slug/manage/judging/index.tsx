import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { assignJudgesFn, judgingProgressQueryOptions } from "@bogey/db/queries/judging";
import {
  eventConflictsQueryOptions,
  eventPinsQueryOptions,
  judgeCalibrationQueryOptions,
} from "@bogey/db/queries/conflicts";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import { eventFlagsQueryOptions } from "@bogey/db/queries/deliberation";
import { flagReason } from "#/components/event/judging/deliberation.tsx";
import { LinkRow } from "@bogey/ui/components/link-row";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { judgingRoundsQueryOptions } from "@bogey/db/queries/judging";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
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
import { msg, useT } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging/")({
  staticData: {
    title: msg("judging.title"),
    settings: (t) => [
      searchSection(t("manageJudging.see"), { id: "what-judges-see" }),
      ...searchSettings("judging", ["blind", "judgeExport"], t),
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
      context.query.ensureQueryData(eventFlagsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingProgressQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventConflictsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPinsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgeCalibrationQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventTeamsQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      context.query.ensureQueryData(assignmentQueries(context.event).settings),
      context.query.ensureQueryData(assignmentQueries(context.event).tags),
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "judging",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event, plugins } = Route.useRouteContext();
  return (
    <Screen title={t("judging.title")} description={t("manageJudging.intro")} width="embedded">
      <Progress />
      <Screen.Section id="what-judges-see" title={t("manageJudging.see")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="judging"
          keys={["blind", "judgeExport"]}
        />
      </Screen.Section>
      <Rounds eventId={event.id} slug={event.slug} plugins={plugins} />
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
          {assign.isPending ? t("manageJudging.assigning") : t("manageJudging.assign")}
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
        <DisclosureList>
          {progress.judges.map((judge) => (
            <DisclosureRow
              key={judge.userId}
              leading={<NameAvatar name={judge.name} />}
              title={judge.name}
              meta={t("manageJudging.judgeMeta", {
                done: judge.done,
                assigned: judge.assigned,
                scored: judge.scored,
              })}
            />
          ))}
        </DisclosureList>
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
        <DisclosureList>
          {flags.map((flag) => (
            <LinkRow
              key={flag.id}
              render={
                <Link
                  to="/events/$slug/judging/$submissionId"
                  params={{ slug: event.slug, submissionId: flag.submissionId }}
                />
              }
              leading={
                <StatusDot
                  tone={flag.resolvedAt ? "done" : "attention"}
                  label={flag.resolvedAt ? t("deliberation.resolved") : t("deliberation.open")}
                />
              }
              title={flag.title}
              meta={[
                flagReason(flag, t),
                ...(flag.resolvedAt
                  ? [
                      flag.resolvedBy
                        ? t("deliberation.resolvedBy", { name: flag.resolvedBy })
                        : t("deliberation.resolvedPlain"),
                    ]
                  : []),
              ].join(" · ")}
            />
          ))}
        </DisclosureList>
      )}
    </Screen.Section>
  );
}
