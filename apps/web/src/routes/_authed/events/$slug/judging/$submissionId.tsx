import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { declareConflictFn } from "@bogey/db/queries/conflicts";
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
  type TeamSubmission,
} from "@bogey/db/queries/submissions";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { queueSheet } from "#/lib/pending-scores.ts";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { CriterionField } from "#/components/event/judging/criterion-field.tsx";
import { DeliberationPanel, FlagButton } from "#/components/event/judging/deliberation.tsx";
import { RubricPicker } from "#/components/event/judging/rubric-picker.tsx";
import { deliberationQueryOptions } from "@bogey/db/queries/deliberation";
import { useCan } from "@bogey/db/permissions";
import { Screen } from "@bogey/ui/components/screen";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { Kbd } from "@bogey/ui/components/kbd";
import { Meter, MeterLabel } from "@bogey/ui/components/meter";
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
import type { Session } from "@bogey/db/auth";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readGuidance } from "@bogey/utils/guidance";

export const Route = createFileRoute("/_authed/events/$slug/judging/$submissionId")({
  staticData: { title: msg("judging.project") },
  loader: async ({ context, params }) => {
    const [submission] = await Promise.all([
      context.query.ensureQueryData(submissionDetailQueryOptions(params.submissionId)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgeProjectQueryOptions(params.submissionId)),
      context.query.ensureQueryData(criteriaQueryOptions(context.event.id)),
      context.query.ensureQueryData(rubricsQueryOptions(context.event.id)),
      context.query.ensureQueryData(deliberationQueryOptions(params.submissionId)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgeSheetQueryOptions(context.event.id, params.submissionId)),
      context.query.ensureQueryData(judgeQueueQueryOptions(context.event.id)),
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["judging"]),
      ),
    ]);
    if (!submission || submission.status !== "submitted") throw notFound();
    return { title: submission.title };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, session } = Route.useRouteContext();
  const { submissionId } = Route.useParams();
  const { data: submission } = useSuspenseQuery(submissionDetailQueryOptions(submissionId));
  const { data: criteria } = useSuspenseQuery(criteriaQueryOptions(event.id));
  const { data: rubrics } = useSuspenseQuery(rubricsQueryOptions(event.id));
  const { data: deliberation } = useSuspenseQuery(deliberationQueryOptions(submissionId));
  const { data: sheet } = useSuspenseQuery(judgeSheetQueryOptions(event.id, submissionId));
  const { data: queue } = useSuspenseQuery(judgeQueueQueryOptions(event.id));
  const { data: roundData } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const declare = useMutation({
    mutationFn: async () => unwrap(await declareConflictFn({ data: { submissionId, reason: "" } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(event.id).queryKey });
      await navigate({ to: "/events/$slug/judging", params: { slug: event.slug } });
    },
  });
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["judging"]),
  );
  const manager = useCan("event.manage");
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
  const hotkey = (name: string) => ({
    meta: { name, description: t("judging.shortcutNextHelp"), group: "Judging" },
  });
  useHotkey("J", () => void go(next), { ...hotkey(t("judging.nextProject")), enabled: !!next });
  useHotkey("K", () => void go(previous), {
    ...hotkey(t("judging.previousProject")),
    enabled: !!previous,
  });
  if (!submission) return null;

  const item = queue.find((candidate) => candidate.submissionId === submissionId);
  const round = roundData.rounds.find((candidate) => candidate.id === sheet.roundId);
  const open = isWindowOpen(windowByKey(windows, round?.windowKey ?? "judging"));
  const flagging =
    (settings.judging.deliberation ?? "assigned") !== "off" &&
    !(deliberation && !deliberation.flag.resolvedAt);
  const rubricEditable = (manager || settings.judging.judgeRubric !== false) && (open || manager);
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
      title={submission.title || t("judging.untitled")}
      description={
        index >= 0
          ? t("judging.queuePosition", { index: index + 1, total: progress.total })
          : submission.teamName
      }
      width="wide"
      actions={
        <>
          {flagging && <FlagButton submissionId={submissionId} />}
          <Button
            size="sm"
            variant="ghost"
            disabled={declare.isPending}
            confirm={{
              title: t("judging.conflictTitle"),
              description: t("judging.conflictBody"),
              label: t("judging.conflictLabel"),
            }}
            onClick={() => declare.mutate()}
          >
            {t("judging.conflictButton")}
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t("judging.previousProject")}
            tooltip={
              <>
                {t("judging.previousProject")} <Kbd>K</Kbd>
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
                {t("judging.nextProject")} <Kbd>J</Kbd>
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
        <Meter value={progress.done} max={progress.total} aria-label={t("judging.yourQueue")}>
          <MeterLabel className="text-muted-fg">
            {t("judging.progress", { done: progress.done, total: progress.total })}
          </MeterLabel>
        </Meter>
      )}
      <JudgingSplit
        project={
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
        }
        score={
          <div className="flex flex-col gap-5">
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
                eventId={event.id}
                session={session}
                method={round.method}
                formId={round.formId}
                roundId={round.id}
                submissionId={submissionId}
              />
            ) : (
              <ScoreCard
                key={`${submissionId}:${sheet.roundId}:${sheet.rubricId ?? ""}`}
                eventId={event.id}
                submission={submission}
                criteria={criteriaFor(criteria, sheet.roundId, sheet.rubricId)}
                sheet={sheet}
                open={open}
                onDone={onDone}
              />
            )}
          </div>
        }
      />
    </Screen>
  );
}

/** Project on one side, scoring on the other; resizable on wide screens, stacked otherwise. */
function JudgingSplit({ project, score }: { project: ReactNode; score: ReactNode }) {
  const wide = useMinWidth("lg");
  const { defaultLayout, onLayoutChanged } = useResizableLayout({
    id: "bogey-judging",
    onlySaveAfterUserInteractions: true,
  });
  if (!wide) {
    return (
      <div className="flex flex-col gap-10">
        {project}
        {score}
      </div>
    );
  }
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="h-[calc(100dvh-var(--layout-offset)-12rem)] min-h-112 rounded-2xl border border-border"
    >
      <ResizablePanel id="project" defaultSize="62%" minSize={320}>
        <div className="h-full overflow-y-auto p-5">{project}</div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="score" defaultSize="38%" minSize={300}>
        <div className="h-full overflow-y-auto p-5">{score}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function MethodPanel({
  eventId,
  session,
  method,
  formId,
  roundId,
  submissionId,
}: {
  eventId: string;
  session: Session;
  method: string;
  formId: string;
  roundId: string;
  submissionId: string;
}) {
  const t = useT();
  const key = method.slice(0, method.indexOf("."));
  return (
    <PluginSlot
      pluginKey={key}
      eventId={eventId}
      missing={
        <p className="rounded-2xl border border-border p-4 text-sm text-muted-fg">
          {t("judging.methodMissing", { key })}
        </p>
      }
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
  submission,
  criteria,
  sheet,
  open,
  onDone,
}: {
  eventId: string;
  submission: TeamSubmission;
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
    ...appFormOptions.strictSchema({
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
        submissionId: submission.id,
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
        setSavedAt(Date.now());
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
          queryKey: judgeSheetQueryOptions(eventId, submission.id).queryKey,
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
  const [savedAt, setSavedAt] = useState<number | null>(null);
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
      <form.Form
        unsaved="draft"
        className="flex flex-col gap-5 rounded-2xl border border-border p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {sheet.roundOrdinal > 1
              ? t("judging.yourScoresRound", { round: sheet.roundName })
              : t("judging.yourScores")}
          </h2>
          <span className="flex items-center gap-2">
            {open && (saving || savedAt !== null) && (
              <span className="text-xs text-muted-fg" aria-live="polite">
                {saving ? t("judging.autosaving") : t("judging.autosaved")}
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
            <form.Submit pending={t("common.saving")} onClick={() => (intent.current = "done")}>
              {t("judging.saveDone")}
            </form.Submit>
          </div>
        )}
      </form.Form>
    </form.AppForm>
  );
}
