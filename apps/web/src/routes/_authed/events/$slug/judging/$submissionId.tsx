import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { declareConflictFn } from "@bogey/db/queries/conflicts";
import { z } from "zod";
import {
  criteriaFor,
  criteriaQueryOptions,
  rubricsQueryOptions,
  judgeQueueQueryOptions,
  judgeSheetQueryOptions,
  judgingRoundsQueryOptions,
  saveSheetFn,
  type SheetChanges,
  type Criterion,
  type JudgeSheet,
} from "@bogey/db/queries/judging";
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
import { IconArrowRight } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { SubmissionAnswers } from "#/components/event/submission/submission-answers.tsx";
import { PluginSlot } from "#/components/plugins/plugin-slot.tsx";
import type { Session } from "@bogey/db/auth";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { useMemo, useRef } from "react";
import { readGuidance } from "@bogey/utils/guidance";

export const Route = createFileRoute("/_authed/events/$slug/judging/$submissionId")({
  staticData: { title: msg("judging.project") },
  loader: async ({ context, params }) => {
    const [submission] = await Promise.all([
      context.query.ensureQueryData(submissionDetailQueryOptions(params.submissionId)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
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
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
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
  if (!submission) return null;

  const form = forms.find((candidate) => candidate.id === submission.form_id);
  const round = roundData.rounds.find((candidate) => candidate.id === sheet.roundId);
  const open = isWindowOpen(windowByKey(windows, round?.windowKey ?? "judging"));
  const index = queue.findIndex((item) => item.submissionId === submissionId);
  const next = queue.slice(index + 1).find((item) => item.status !== "done");
  const manager = useCan("event.manage");
  const flagging =
    (settings.judging.deliberation ?? "assigned") !== "off" &&
    !(deliberation && !deliberation.flag.resolvedAt);
  const rubricEditable = (manager || settings.judging.judgeRubric !== false) && (open || manager);

  return (
    <Screen
      title={submission.title || t("judging.untitled")}
      description={[submission.teamName, form?.title].filter(Boolean).join(" · ")}
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
          {next && (
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={
                <Link
                  to="/events/$slug/judging/$submissionId"
                  params={{ slug: event.slug, submissionId: next.submissionId }}
                />
              }
            >
              {t("judging.nextProject")}
              <IconArrowRight />
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <section className="min-w-0">
          <DeliberationPanel submissionId={submissionId} criteria={criteria} />
          {form ? (
            <SubmissionAnswers
              form={form}
              submission={submission}
              files={submission.files}
              blind={settings.judging.blind === true}
            />
          ) : (
            <p className="text-sm text-muted-fg">{t("judging.formRemoved")}</p>
          )}
        </section>
        <aside className="flex flex-col gap-5 lg:sticky lg:top-(--layout-offset) lg:self-start">
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
              key={JSON.stringify(sheet)}
              eventId={event.id}
              submission={submission}
              criteria={criteriaFor(criteria, sheet.roundId, sheet.rubricId)}
              sheet={sheet}
              open={open}
            />
          )}
        </aside>
      </div>
    </Screen>
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
}: {
  eventId: string;
  submission: TeamSubmission;
  criteria: Tuple<Criterion>;
  sheet: JudgeSheet;
  open: boolean;
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
      if (!result.ok && result.error.code === "unavailable") {
        queueSheet(changes);
        formApi.reset(value);
        return undefined;
      }
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: judgeSheetQueryOptions(eventId, submission.id).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(eventId).queryKey }),
      ]);
      return undefined;
    },
  });

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
          {sheet.status === "done" && <Badge variant="secondary">{t("judging.done")}</Badge>}
        </div>
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
            <form.Submit
              variant="outline"
              pending={t("common.saving")}
              onClick={() => (intent.current = "save")}
            >
              {t("judging.saveLater")}
            </form.Submit>
          </div>
        )}
      </form.Form>
    </form.AppForm>
  );
}
