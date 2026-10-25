import { createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  criteriaFor,
  criteriaQueryOptions,
  rubricsQueryOptions,
  judgeProjectQueryOptions,
  judgeQueueQueryOptions,
  judgeSheetQueryOptions,
  judgingRoundsQueryOptions,
  saveSheetFn,
  type SheetChanges,
  type Criterion,
  type JudgeSheet,
} from "@bogey/db/queries/judging";
import {
  judgingProgress,
  judgingSteps,
  nextToScore,
  queueNeighbours,
} from "@bogey/db/queries/judging-flow";
import {
  submissionDetailQueryOptions,
  submissionFormsQueryOptions,
} from "@bogey/db/queries/submissions";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { queueSheet } from "#/lib/pending-scores.ts";
import { requestFailure } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { CriterionField } from "#/components/event/judging/criterion-field.tsx";
import { DeliberationPanel } from "#/components/event/judging/deliberation.tsx";
import { FlagMenu } from "#/components/event/judging/flag-menu.tsx";
import { RubricPicker } from "#/components/event/judging/rubric-picker.tsx";
import { DivisionPicker } from "#/components/event/judging/division-picker.tsx";
import { GuideViewer, type JudgeGuide } from "#/components/event/judging/judge-guide.tsx";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { deliberationQueryOptions } from "@bogey/db/queries/deliberation";
import { useCan } from "@bogey/db/permissions";
import { Screen } from "@bogey/ui/components/screen";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { Kbd } from "@bogey/ui/components/kbd";
import { Meter } from "@bogey/ui/components/meter";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout,
} from "@bogey/ui/components/resizable";
import { useMinWidth } from "@bogey/ui/hooks/media";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useSelector } from "@tanstack/react-form";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { ProjectPanel } from "./-components/project-panel.tsx";
import { PluginSlot } from "#/components/plugins/plugin-slot.tsx";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readGuidance } from "@bogey/utils/guidance";

export const Route = createFileRoute("/_authed/events/$slug/judging/$submissionId")({
  staticData: { title: msg("judging.project") },
  loader: async ({ context, params }) => {
    const query = context.query;
    const { submissionId } = params;
    const eventId = context.event.id;
    // the project's own data loads behind skeletons, so J/K switch at once
    const project = Promise.all([
      query.prefetchQuery(submissionDetailQueryOptions(submissionId)),
      query.prefetchQuery(judgeProjectQueryOptions(submissionId)),
      query.prefetchQuery(deliberationQueryOptions(submissionId)),
      query.prefetchQuery(judgeSheetQueryOptions(eventId, submissionId)),
    ]);
    const [queue] = await Promise.all([
      query.query({ ...judgeQueueQueryOptions(eventId), staleTime: "static" }),
      query.query({ ...submissionFormsQueryOptions(eventId), staleTime: "static" }),
      query.query({ ...criteriaQueryOptions(eventId), staleTime: "static" }),
      query.query({ ...rubricsQueryOptions(eventId), staleTime: "static" }),
      query.query({ ...eventDivisionsQueryOptions(eventId), staleTime: "static" }),
      query.query({ ...judgingRoundsQueryOptions(eventId), staleTime: "static" }),
      query.query({ ...eventWindowsQueryOptions(eventId), staleTime: "static" }),
      query.query({
        ...settingsQueryOptions({ eventId }, ["judging"]),
        staleTime: "static",
      }),
    ]);
    const item = queue.find((candidate) => candidate.submissionId === submissionId);
    if (item) return { title: item.title };
    // outside the queue (browsing), only a submitted project can be judged
    await project;
    const submission = query.getQueryData(submissionDetailQueryOptions(submissionId).queryKey);
    if (!submission || submission.status !== "submitted") throw notFound();
    return { title: submission.title };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { submissionId } = Route.useParams();
  const { data: queue } = useSuspenseQuery(judgeQueueQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["judging"]),
  );
  const { data: criteria } = useSuspenseQuery(criteriaQueryOptions(event.id));
  const submission = useQuery(submissionDetailQueryOptions(submissionId));
  const deliberation = useQuery(deliberationQueryOptions(submissionId));
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const leaveProject = async () => {
    await queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(event.id).queryKey });
    await navigate({ to: "/events/$slug/judging", params: { slug: event.slug } });
  };
  const steps = judgingSteps({
    queue,
    deliberation: settings.judging.deliberation,
    browseProjects: settings.judging.browseProjects,
  });
  const { index, previous, next } = queueNeighbours(steps, submissionId);
  const progress = judgingProgress(steps);
  const go = (id: string | null) =>
    id
      ? navigate({
          to: "/events/$slug/judging/$submissionId",
          params: { slug: event.slug, submissionId: id },
        })
      : undefined;
  // the projects either side are loaded ahead, so moving to them shows them straight away
  useEffect(() => {
    for (const id of [previous, next]) {
      if (!id) continue;
      void router
        .preloadRoute({
          to: "/events/$slug/judging/$submissionId",
          params: { slug: event.slug, submissionId: id },
        })
        .catch(() => undefined);
    }
  }, [router, event.slug, previous, next]);
  const hotkey = (name: string) => ({
    meta: { name, description: t("judging.shortcutNextHelp"), group: "Judging" },
  });
  useHotkey("K", () => void go(next), { ...hotkey(t("judging.nextProject")), enabled: !!next });
  useHotkey("J", () => void go(previous), {
    ...hotkey(t("judging.previousProject")),
    enabled: !!previous,
  });

  const item = queue.find((candidate) => candidate.submissionId === submissionId);
  const title = item?.title ?? submission.data?.title;
  const flagging =
    (settings.judging.deliberation ?? "assigned") !== "off" &&
    !(deliberation.data && !deliberation.data.flag.resolvedAt);
  // after marking done, the next unfinished project, or the queue's done state
  const onDone = () => {
    const after = nextToScore(
      steps.map((step) => (step.submissionId === submissionId ? { ...step, done: true } : step)),
      submissionId,
    );
    return after?.submissionId
      ? go(after.submissionId)
      : navigate({ to: "/events/$slug/judging", params: { slug: event.slug } });
  };

  return (
    <Screen
      title={title === undefined ? "\u00a0" : title || t("judging.untitled")}
      description={
        index >= 0
          ? `${t("judging.queuePosition", { index: index + 1, total: progress.total })} · ${t("judging.progress", { done: progress.done, total: progress.total })}`
          : (item?.teamName ?? submission.data?.teamName ?? "\u00a0")
      }
      width="superwide"
      actions={
        <>
          <FlagMenu
            submissionId={submissionId}
            canDeliberate={flagging}
            onConflict={leaveProject}
          />
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t("judging.previousProject")}
            tooltip={
              <>
                {t("judging.previousProject")} <Kbd>J</Kbd>
              </>
            }
            disabled={!previous}
            onClick={() => void go(previous)}
          >
            <IconArrowLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t("judging.nextProject")}
            tooltip={
              <>
                {t("judging.nextProject")} <Kbd>K</Kbd>
              </>
            }
            disabled={!next}
            onClick={() => void go(next)}
          >
            <IconArrowRight />
          </Button>
        </>
      }
    >
      {progress.total > 0 && (
        <Meter
          value={progress.done}
          max={progress.total}
          aria-label={t("judging.progress", { done: progress.done, total: progress.total })}
          className="-mt-2"
        />
      )}
      <JudgingSplit
        resetKey={submissionId}
        guide={settings.judging.guide}
        project={
          <Suspense key={submissionId} fallback={<ProjectSkeleton />}>
            <div className="flex flex-col gap-6">
              <DeliberationPanel submissionId={submissionId} criteria={criteria} />
              <ProjectPanel
                eventId={event.id}
                timeZone={event.timezone}
                submissionId={submissionId}
                item={item}
                blind={settings.judging.blind === true}
              />
            </div>
          </Suspense>
        }
        score={
          <Suspense key={submissionId} fallback={<ScoreSkeleton />}>
            <ScorePanel submissionId={submissionId} onDone={onDone} />
          </Suspense>
        }
      />
    </Screen>
  );
}

/** The division, rubric and scores for one project. */
function ScorePanel({ submissionId, onDone }: { submissionId: string; onDone: () => unknown }) {
  const t = useT();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const manager = useCan("event.manage");
  const { data: submission } = useSuspenseQuery(submissionDetailQueryOptions(submissionId));
  const { data: sheet } = useSuspenseQuery(judgeSheetQueryOptions(event.id, submissionId));
  const { data: project } = useSuspenseQuery(judgeProjectQueryOptions(submissionId));
  const { data: criteria } = useSuspenseQuery(criteriaQueryOptions(event.id));
  const { data: rubrics } = useSuspenseQuery(rubricsQueryOptions(event.id));
  const { data: roundData } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["judging"]),
  );
  const round = roundData.rounds.find((candidate) => candidate.id === sheet.roundId);
  const open = isWindowOpen(windowByKey(windows, round?.windowKey ?? "judging"));
  const rubricEditable = (manager || settings.judging.judgeRubric !== false) && (open || manager);
  const divisionEditable =
    (manager || settings.judging.judgeDivision !== false) && (open || manager);
  // a move changes the team's division, so its rubric fallback and queue entry too
  const onMoved = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: judgeProjectQueryOptions(submissionId).queryKey }),
      queryClient.invalidateQueries({
        queryKey: judgeSheetQueryOptions(event.id, submissionId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(event.id).queryKey }),
    ]);

  return (
    <div className="flex flex-col gap-5">
      {/* blind judging hides teams, and so their division, from judges */}
      {(manager || settings.judging.blind !== true) && (
        <DivisionPicker
          eventId={event.id}
          submissionId={submissionId}
          form={forms.find((form) => form.id === submission?.form_id)}
          value={project?.divisionId ?? null}
          editable={divisionEditable}
          onMoved={onMoved}
        />
      )}
      {(!round || round.method === "rubric") && (
        <RubricPicker
          submissionId={submissionId}
          rubrics={rubrics}
          value={sheet.rubric}
          editable={rubricEditable}
          description={t("rubric.judgeHelp")}
          onPicked={() =>
            queryClient.invalidateQueries({
              queryKey: judgeSheetQueryOptions(event.id, submissionId).queryKey,
            })
          }
        />
      )}
      {round && round.method !== "rubric" ? (
        <MethodPanel
          method={round.method}
          formId={round.formId}
          roundId={round.id}
          submissionId={submissionId}
        />
      ) : (
        <ScoreCard
          key={`${submissionId}:${sheet.roundId}:${sheet.rubricId ?? ""}`}
          eventId={event.id}
          submissionId={submissionId}
          criteria={criteriaFor(criteria, sheet.roundId, sheet.rubricId)}
          sheet={sheet}
          open={open}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid max-w-sm grid-cols-[5rem_1fr] gap-x-6 gap-y-2.5">
        {[0, 1, 2, 3].map((row) => (
          <Fragment key={row}>
            <Skeleton className="h-4 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
          </Fragment>
        ))}
      </div>
      <Skeleton className="h-8 w-28 rounded-pill" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-5/6 rounded-md" />
        <Skeleton className="h-4 w-3/4 rounded-md" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

function ScoreSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20 rounded-md" />
        <Skeleton className="h-4 w-28 rounded-md" />
      </div>
      <Skeleton className="h-6 w-32 rounded-md" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36 rounded-md" />
          <Skeleton className="h-8 w-full max-w-sm rounded-md" />
        </div>
      ))}
    </div>
  );
}

type Side = "project" | "guide";

/** Project (or the judges' guide) on one side, scoring on the other; resizable on wide screens, stacked otherwise. */
function JudgingSplit({
  project,
  score,
  guide,
  resetKey,
}: {
  project: ReactNode;
  score: ReactNode;
  guide: JudgeGuide | undefined;
  resetKey: string;
}) {
  const t = useT();
  const wide = useMinWidth("lg");
  const [side, setSide] = useState<Side>("project");
  const projectScroll = useRef<HTMLDivElement>(null);
  const scoreScroll = useRef<HTMLDivElement>(null);
  const { defaultLayout, onLayoutChanged } = useResizableLayout({
    id: "bogey-judging",
    onlySaveAfterUserInteractions: true,
  });
  // a new project starts at its top
  useEffect(() => {
    projectScroll.current?.scrollTo({ top: 0 });
    scoreScroll.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  const left = guide ? (
    <Tabs value={side} onValueChange={(next: Side) => setSide(next)} className="h-full gap-4">
      <TabsList variant="switch" aria-label={t("judgeGuide.view")}>
        <TabsTrigger value="project">{t("judgeGuide.projectTab")}</TabsTrigger>
        <TabsTrigger value="guide">{t("judgeGuide.tab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="project">{project}</TabsContent>
      {/* stays mounted so the PDF keeps its page while moving between projects */}
      <TabsContent value="guide" keepMounted className="min-h-0">
        <GuideViewer guide={guide} className={wide ? "h-full" : "h-[80dvh]"} />
      </TabsContent>
    </Tabs>
  ) : (
    project
  );

  if (!wide) {
    return (
      <div className="flex flex-col gap-10">
        {left}
        {score}
      </div>
    );
  }
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="h-[calc(100dvh-var(--layout-offset)-10rem)] min-h-112"
    >
      <ResizablePanel id="project" defaultSize="62%" minSize={320}>
        <div ref={projectScroll} className="h-full overflow-y-auto pr-6">
          {left}
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="score" defaultSize="38%" minSize={300}>
        <div ref={scoreScroll} className="h-full overflow-y-auto pl-6">
          {score}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function MethodPanel({
  method,
  formId,
  roundId,
  submissionId,
}: {
  method: string;
  formId: string;
  roundId: string;
  submissionId: string;
}) {
  const t = useT();
  const { event, session } = Route.useRouteContext();
  const eventId = event.id;
  const key = method.slice(0, method.indexOf("."));
  return (
    <PluginSlot
      pluginKey={key}
      eventId={eventId}
      missing={<p className="text-sm text-muted-fg">{t("judging.methodMissing", { key })}</p>}
    >
      {({ slots, settings }) => {
        const Panel = slots.judgingPanel;
        return Panel ? (
          <Panel
            eventId={eventId}
            settings={settings}
            session={session}
            method={method}
            formId={formId}
            roundId={roundId}
            submissionId={submissionId}
          />
        ) : null;
      }}
    </PluginSlot>
  );
}

const sheetSchema = (t: T) =>
  z.object({
    scores: z.record(z.string(), z.number().nullable()),
    feedback: z
      .string()
      .max(10_000, t("form.maxLength", { max: 10_000 }))
      .meta({ label: t("judging.notes") })
      .describe(t("judging.notesHelp")),
    share: z
      .boolean()
      .meta({ label: t("judging.share") })
      .describe(t("judging.shareHelp")),
  });

function ScoreCard({
  eventId,
  submissionId,
  criteria,
  sheet,
  open,
  onDone,
}: {
  eventId: string;
  submissionId: string;
  criteria: Tuple<Criterion>;
  sheet: JudgeSheet;
  open: boolean;
  onDone: () => unknown;
}) {
  const t = useT();
  const schema = useMemo(() => sheetSchema(t), [t]);
  const queryClient = useQueryClient();
  const intent = useRef<"save" | "done">("save");
  const scores: { [criterionId: string]: number | null } = Object.fromEntries(
    criteria.map((criterion) => [criterion.id, sheet.scores[criterion.id] ?? null]),
  );

  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: {
        scores,
        feedback: sheet.feedback?.body ?? "",
        share: sheet.feedback?.visibility === "team",
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const missing = criteria.filter((criterion) => value.scores[criterion.id] == null);
      if (intent.current === "done" && missing.length) {
        return createValidationError(
          t("judging.scoreFirst", {
            criteria: missing.map((criterion) => criterion.label).join(", "),
          }),
        );
      }
      const changes: SheetChanges = {
        eventId,
        submissionId: submissionId,
        scores: criteria.flatMap((criterion) => {
          const score = value.scores[criterion.id];
          return score == null ? [] : [{ criterionId: criterion.id, value: score }];
        }),
        feedback: value.feedback,
        visibility: value.share ? "team" : "judges",
        done: intent.current === "done",
      };
      const result = await saveSheetFn({ data: changes }).catch(requestFailure);
      const finish = () => {
        saved.current = JSON.stringify(value);
        // keep anything typed while the save was in flight
        if (JSON.stringify(formApi.state.values) === saved.current) formApi.reset(value);
      };
      if (!result.ok && result.error.code === "unavailable") {
        queueSheet(changes);
        finish();
        if (changes.done) await onDone();
        return undefined;
      }
      if (!result.ok) return createValidationError(result.error.message);
      finish();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: judgeSheetQueryOptions(eventId, submissionId).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(eventId).queryKey }),
      ]);
      if (changes.done) await onDone();
      return undefined;
    },
  });

  // autosave a moment after the last change
  const values = useSelector(form.atom, (state) => state.values);
  const saving = useSelector(form.atom, (state) => state.isSubmitting);
  const saved = useRef(JSON.stringify(form.state.values));
  useEffect(() => {
    if (!open || JSON.stringify(values) === saved.current) return;
    const timer = setTimeout(() => {
      if (form.state.isSubmitting) return;
      intent.current = "save";
      void form.handleSubmit();
    }, 1200);
    return () => clearTimeout(timer);
  }, [values, open, form]);
  useHotkey(
    "Mod+Enter",
    () => {
      intent.current = "done";
      void form.handleSubmit();
    },
    {
      enabled: open,
      meta: {
        name: t("judging.saveDone"),
        description: t("judging.shortcutDoneHelp"),
        group: "Judging",
      },
    },
  );

  return (
    <form.AppForm>
      <form.Form unsaved="draft" className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {sheet.roundOrdinal > 1
              ? t("judging.yourScoresRound", { round: sheet.roundName })
              : t("judging.yourScores")}
          </h2>
          <span className="flex items-center gap-2">
            {open && saving && (
              <span className="text-xs text-muted-fg" aria-live="polite">
                {t("judging.autosaving")}...
              </span>
            )}
            {sheet.status === "done" && <Badge variant="secondary">{t("judging.done")}</Badge>}
          </span>
        </div>
        {open && <p className="text-sm text-muted-fg">{t("judging.autosaveHelp")}</p>}
        {!open && <p className="text-sm text-muted-fg">{t("judging.closedSheet")}</p>}
        {criteria.length === 0 && (
          <p className="text-sm text-muted-fg">{t("judging.noCriteria")}</p>
        )}
        <fieldset disabled={!open} className="flex flex-col gap-5">
          {criteria.map((criterion) => (
            <form.Field key={criterion.id} name={`scores.${criterion.id}`}>
              {(field) => (
                <CriterionField
                  criterion={{
                    id: criterion.id,
                    label: criterion.label,
                    descriptionMd: criterion.description_md,
                    minScore: criterion.min_score,
                    maxScore: criterion.max_score,
                    guidance: readGuidance(criterion.guidance),
                  }}
                  value={field.value ?? null}
                  disabled={!open}
                  onChange={(score) => field.handleChange(score)}
                />
              )}
            </form.Field>
          ))}
          <form.Field name="feedback">{(field) => <field.TextAreaField rows={4} />}</form.Field>
          <form.Field name="share">{(field) => <field.SwitchField />}</form.Field>
        </fieldset>
        <form.FormAlert title={t("judging.notSaved")} />
        {open && (
          <div className="flex flex-col gap-2">
            <form.Submit
              pending={`${t("common.saving")}...`}
              onClick={() => (intent.current = "done")}
            >
              {t("judging.saveDone")}
            </form.Submit>
          </div>
        )}
      </form.Form>
    </form.AppForm>
  );
}
