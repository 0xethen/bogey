import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { GalleryLook } from "#/components/event/submission/gallery-look.tsx";
import { browserClient } from "@bogey/db/browser";
import {
  addSubmissionFileFn,
  cancelSubmissionDeletionFn,
  deleteSubmissionFn,
  mySubmissionsQueryOptions,
  removeSubmissionFileFn,
  saveSubmissionFn,
  startSubmissionFn,
  submitProjectFn,
  type MySubmissions,
  type Submission,
  type SubmissionFile,
  type SubmissionForm,
} from "@bogey/db/queries/submissions";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { networkStatusQueryOptions, settingsQueryOptions } from "@bogey/db/queries/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { answerProblem } from "@bogey/utils/answers";
import { TeamFeedback } from "#/routes/_authed/events/$slug/-components/team-feedback.tsx";
import { DemoNotice } from "#/components/event/judging/demo-notice.tsx";
import { TableNotice } from "#/components/event/judging/table-notice.tsx";
import { RubricPicker } from "#/components/event/judging/rubric-picker.tsx";
import {
  criteriaQueryOptions,
  rubricsQueryOptions,
  submissionRubricQueryOptions,
  NO_PROJECT_RUBRIC,
} from "@bogey/db/queries/judging";
import { PrizePicker } from "#/routes/_authed/events/$slug/-components/prize-picker.tsx";
import { eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { ReviewStep } from "#/components/event/submission/review-step.tsx";
import { Stepper } from "#/components/event/submission/stepper.tsx";
import { jumpTo } from "#/lib/jump.ts";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@bogey/ui/components/field";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { Markdown } from "@bogey/ui/components/markdown";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { Steps } from "#/components/event/submission/steps.tsx";
import { Screen } from "@bogey/ui/components/screen";
import { cn } from "@bogey/ui/lib/utils";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheck,
  IconEyeOff,
  IconUserQuestion,
} from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { SubmissionItemField } from "#/components/event/submission/submission-item-field.tsx";
import { formatRelative } from "@bogey/utils/time";
import { useLocale } from "@bogey/ui/lib/locale";
import { useHelperSay, useT } from "#/lib/translate.tsx";
import type { createTranslator } from "@bogey/utils/messages";
import type { en } from "@bogey/config/messages";
import { useCan } from "@bogey/db/permissions";
import { hasSubmissionPage, inEvent, useEvent } from "#/lib/viewer.ts";
import { useUploadMb } from "#/lib/uploads.ts";

const stepSchema = z.enum(["prizes", "review"]);

export const Route = createFileRoute("/_authed/events/$slug/submission")({
  staticData: { title: "Submission", command: { when: inEvent(hasSubmissionPage) } },
  validateSearch: z.object({
    form: z.string().optional().catch(undefined),
    step: stepSchema.optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => ({ participant: context.access.role === "participant" }),
  loader: async ({ context }) => {
    if (!context.participant) return;
    await Promise.all([
      context.query.ensureQueryData(mySubmissionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["submissions"]),
      ),
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["judging"]),
      ),
      context.query.ensureQueryData(networkStatusQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPrizesQueryOptions(context.event.id)),
      context.query.ensureQueryData(rubricsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
    ]);
  },
  component: RouteComponent,
});

type Entry = MySubmissions["forms"][number];
type Translate = ReturnType<typeof createTranslator<typeof en>>;

function RouteComponent() {
  const t = useT();
  const { event, participant } = Route.useRouteContext();
  const manages = useCan("event.manage");
  if (!participant) {
    return (
      <Screen.Fallback
        icon={<IconUserQuestion />}
        title={t("sub.forParticipants")}
        description={
          <>
            {t("sub.forParticipantsBody1")}
            <br />
            <br />
            {t("sub.forParticipantsBody2")}
          </>
        }
      >
        {manages && (
          <Screen.Actions>
            <Button
              render={<Link to="/events/$slug/manage/submissions" params={{ slug: event.slug }} />}
              nativeButton={false}
            >
              {t("sub.seeEvery")}
            </Button>
          </Screen.Actions>
        )}
      </Screen.Fallback>
    );
  }
  return <ParticipantSubmission />;
}

function ParticipantSubmission() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { form: selectedKey } = Route.useSearch();
  const { data } = useSuspenseQuery(mySubmissionsQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const entry = data.forms.find((item) => item.form.key === selectedKey) ?? data.forms[0];
  const open = (form: SubmissionForm) => isWindowOpen(windowByKey(windows, form.window_key));
  if (!entry) {
    return (
      <Screen title={t("sub.title")} description={t("sub.nothingYet")}>
        <p className="text-sm text-muted-fg">{t("sub.noForm")}</p>
      </Screen>
    );
  }

  return (
    <Screen
      title={data.forms.length > 1 ? t("sub.titles") : entry.form.title}
      description={
        data.team ? t("sub.teamCanEdit", { team: data.team.name }) : t("sub.belongToTeam")
      }
      width="wide"
    >
      {data.forms.length > 1 && (
        <nav aria-label={t("sub.titles")} className="-mx-1 flex gap-1 overflow-x-auto">
          {data.forms.map((item) => (
            <Link
              key={item.form.id}
              to="/events/$slug/submission"
              params={{ slug: event.slug }}
              search={{ form: item.form.key }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm no-underline",
                item.form.id === entry.form.id
                  ? "bg-muted font-medium text-fg"
                  : "text-muted-fg hocus:bg-muted hocus:text-fg",
              )}
            >
              <FormStatus entry={item} open={open(item.form)} />
              {item.form.title}
            </Link>
          ))}
        </nav>
      )}

      {!data.team ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-fg">{t("sub.teamFirst")}</p>
          <div>
            <Button
              nativeButton={false}
              render={<Link to="/events/$slug/team" params={{ slug: event.slug }} />}
            >
              {t("sub.goToTeam")}
            </Button>
          </div>
        </div>
      ) : !entry.submission ? (
        <StartSubmission entry={entry} teamId={data.team.id} open={open(entry.form)} />
      ) : (
        <SubmissionEditor
          key={`${entry.submission.id}-${entry.submission.updated_at}`}
          entry={entry}
          submission={entry.submission}
          team={data.team}
          open={open(entry.form)}
        />
      )}
    </Screen>
  );
}

function FormStatus({ entry, open }: { entry: Entry; open: boolean }) {
  const t = useT();
  const status = entry.submission?.status;
  return (
    <StatusDot
      tone={status === "submitted" ? "done" : open ? "attention" : "idle"}
      label={
        status === "submitted"
          ? t("sub.statusSubmitted")
          : status === "draft"
            ? t("sub.statusDraft")
            : open
              ? t("sub.statusOpen")
              : t("sub.statusNotOpen")
      }
    />
  );
}

function StartSubmission({ entry, teamId, open }: { entry: Entry; teamId: string; open: boolean }) {
  const t = useT();
  const event = useEvent();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await startSubmissionFn({ data: { eventId: event.id, formId: entry.form.id, teamId } }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: mySubmissionsQueryOptions(event.id).queryKey }),
  });
  const count = entry.form.items.length;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      {entry.form.description_md && (
        <Markdown features="short">{entry.form.description_md}</Markdown>
      )}
      <p className="text-sm text-muted-fg">
        {open ? t("sub.itemsToFill", { count }) : t("sub.notOpen")}
      </p>
      {open && (
        <div>
          <Button disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? `${t("sub.starting")}...` : t("sub.startDraft")}
          </Button>
        </div>
      )}
      <ErrorAlert error={start.error} title={t("sub.startFailed")} />
    </section>
  );
}

function missingItems(
  values: { title: string; answers: { [key: string]: string | boolean } },
  form: SubmissionForm,
  files: Tuple<SubmissionFile>,
  members: number,
  minimum: number,
  t: Translate,
): string[] {
  const missing: string[] = [];
  if (!values.title.trim()) missing.push(t("sub.missingTitle"));
  for (const item of form.items) {
    if (!item.required) continue;
    if (item.kind === "file") {
      if (!files.some((file) => file.item_key === item.key)) missing.push(item.label);
    } else if (answerProblem(item, values.answers[item.key])) {
      missing.push(item.label);
    }
  }
  if (members < minimum) missing.push(t("sub.missingTeam", { count: minimum }));
  return missing;
}

function initialAnswers(form: SubmissionForm, saved: Submission["answers"]) {
  const stored = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const answers: { [key: string]: string | boolean } = {};
  for (const item of form.items) {
    if (item.kind === "file") continue;
    const before = stored[item.key];
    answers[item.key] =
      item.kind === "boolean"
        ? before === true
        : typeof before === "string"
          ? before
          : typeof before === "number"
            ? String(before)
            : "";
  }
  return answers;
}

type StepKey = "project" | z.infer<typeof stepSchema>;

function SubmissionEditor({
  entry,
  submission,
  team,
  open,
}: {
  entry: Entry;
  submission: Submission;
  team: NonNullable<MySubmissions["team"]>;
  open: boolean;
}) {
  const t = useT();
  const event = useEvent();
  const say = useHelperSay();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const { step: stepParam } = Route.useSearch();
  const intent = useRef<"save" | "submit" | "next">("save");
  const { form: definition, files } = entry;

  const schema = z.object({
    title: z
      .string()
      .max(120, t("sub.titleTooLong"))
      .meta({ label: t("sub.titleLabel"), placeholder: t("sub.titlePlaceholder") }),
    isPublic: z
      .boolean()
      .meta({ label: t("sub.publicLabel") })
      .describe(t("sub.publicHelp")),
    answers: z.object(
      Object.fromEntries(
        definition.items
          .filter((item) => item.kind !== "file")
          .map((item) => [
            item.key,
            z.union([z.string(), z.boolean()]).superRefine((value, ctx) => {
              const problem = answerProblem({ ...item, required: false }, value, say);
              if (problem) ctx.addIssue({ code: "custom", message: problem });
            }),
          ]),
      ),
    ),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: mySubmissionsQueryOptions(event.id).queryKey });

  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["judging"]),
  );
  const { data: prizes } = useSuspenseQuery(eventPrizesQueryOptions(event.id));
  const { data: rubrics } = useSuspenseQuery(rubricsQueryOptions(event.id));
  const hasPrizes = prizes.some(
    (prize) => prize.optIn && (prize.formId === null || prize.formId === submission.form_id),
  );
  const hasRubric = definition.judged && settings.judging.teamRubric === true && rubrics.length > 0;
  const steps: Tuple<{ key: StepKey; title: string }> = [
    { key: "project", title: t("sub.stepProject") },
    ...(hasPrizes || hasRubric
      ? [{ key: "prizes" as const, title: hasPrizes ? t("sub.stepPrizes") : t("sub.stepRubric") }]
      : []),
    { key: "review", title: t("sub.stepReview") },
  ];
  const index = Math.max(
    0,
    steps.findIndex((each) => each.key === stepParam),
  );
  const step = steps[index]?.key ?? "project";
  const goTo = (key: StepKey) =>
    navigate({ search: (prev) => ({ ...prev, step: key === "project" ? undefined : key }) });
  const nextStep = steps[index + 1]?.key;

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        title: submission.title,
        isPublic: submission.is_public,
        answers: initialAnswers(definition, submission.answers),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmitInvalid: () => {
      if (step !== "project") void goTo("project");
    },
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const saving = await saveSubmissionFn({
        data: {
          id: submission.id,
          title: value.title,
          answers: value.answers,
          isPublic: value.isPublic,
        },
      }).catch(requestFailure);
      if (!saving.ok) return createValidationError(saving.error.message);
      formApi.reset(value);

      if (intent.current === "submit") {
        const missing = missingItems(
          value,
          definition,
          files,
          team.members,
          event.team_size_min,
          t,
        );
        if (missing.length > 0) {
          return createValidationError(t("sub.savedMissing", { items: missing.join(", ") }));
        }
        const submitting = await submitProjectFn({ data: { id: submission.id } }).catch(
          requestFailure,
        );
        if (!submitting.ok) return createValidationError(submitting.error.message);
      }
      if (intent.current === "next" && nextStep) await goTo(nextStep);
      await refresh();
      return undefined;
    },
  });

  const unsubmit = useMutation({
    mutationFn: async () =>
      unwrap(await submitProjectFn({ data: { id: submission.id, submit: false } })),
    onSuccess: refresh,
  });

  const submitted = submission.status === "submitted";
  const { data: network } = useSuspenseQuery(networkStatusQueryOptions(event.id));
  const offNetwork =
    network.restricted &&
    !network.allowed &&
    (network.areas.length === 0 || network.areas.includes("submissions"));
  const editable = open && submission.status !== "disqualified" && !offNetwork;
  const blind = settings.judging.blind === true && definition.judged;
  const { data: submissionSettings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["submissions"]),
  );
  const publicLocked = submissionSettings.submissions.publicToggle === false;
  const { submittedTitle, submittedBody } = submissionSettings.submissions;
  const jump = (target: string) => {
    if (step === "project") return jumpTo(target);
    void goTo("project").then(() => requestAnimationFrame(() => jumpTo(target)));
  };

  return (
    <div className="flex flex-col gap-6">
      {offNetwork && open && (
        <ErrorAlert title={t("sub.networkTitle")} error={t("sub.networkBody")} />
      )}
      <TableNotice tables={[submission.table_label]} />
      <DemoNotice event={event} />
      <TeamFeedback submissionId={submission.id} />
      {submission.status === "disqualified" && (
        <ErrorAlert title={t("sub.disqualified")} error={t("sub.disqualifiedBody")} />
      )}
      {submitted && submission.submitted_at && (
        <Alert>
          <IconCircleCheck />
          <AlertTitle>{submittedTitle || t("sub.submittedTitle")}</AlertTitle>
          <AlertDescription>
            {submittedBody
              ? submittedBody.replaceAll(
                  "{when}",
                  formatRelative(submission.submitted_at, undefined, locale),
                )
              : t("sub.submittedBody", {
                  when: formatRelative(submission.submitted_at, undefined, locale),
                  until: open ? t("sub.untilCloses") : "",
                })}
          </AlertDescription>
        </Alert>
      )}
      {!open && !submitted && (
        <ErrorAlert title={t("sub.notSubmitted")} error={t("sub.closedDraft")} />
      )}

      <Stepper
        steps={steps}
        current={index}
        className="max-w-2xl"
        onSelect={(picked) => {
          const key = steps[picked]?.key;
          if (key) void goTo(key);
        }}
      />

      <form.AppForm>
        <form.Form unsaved="draft" className="grid gap-10 lg:grid-cols-[1fr_18rem]">
          <div className="flex min-w-0 flex-col gap-10">
            <fieldset
              disabled={!editable}
              className={cn("flex min-w-0 flex-col gap-10", step !== "project" && "hidden")}
            >
              {definition.description_md && (
                <Markdown features="short">{definition.description_md}</Markdown>
              )}
              {blind && (
                <Alert>
                  <IconEyeOff />
                  <AlertTitle>{t("sub.blindTitle")}</AlertTitle>
                  <AlertDescription>{t("sub.blindBody")}</AlertDescription>
                </Alert>
              )}
              <FieldGroup>
                <form.Field name="title">{(field) => <field.TextField required />}</form.Field>
                {definition.items.map((item) =>
                  item.kind === "file" ? (
                    <FileItem
                      key={item.key}
                      item={item}
                      submission={submission}
                      teamId={team.id}
                      files={files.filter((file) => file.item_key === item.key)}
                      disabled={!editable}
                      onChanged={refresh}
                    />
                  ) : (
                    <form.Field key={item.key} name={`answers.${item.key}`}>
                      {(field) => (
                        <SubmissionItemField
                          item={item}
                          id={field.name}
                          value={field.value}
                          errors={field.meta.errors}
                          onChange={(next) => field.handleChange(next)}
                          onBlur={field.handleBlur}
                          blind={blind}
                        />
                      )}
                    </form.Field>
                  ),
                )}
              </FieldGroup>
            </fieldset>

            {step === "prizes" && (
              <div className="flex min-w-0 flex-col gap-10">
                <PrizePicker
                  submissionId={submission.id}
                  formId={submission.form_id}
                  disabled={!editable}
                />
                {hasRubric && (
                  <TeamRubric
                    submissionId={submission.id}
                    editable={editable}
                    showCriteria={settings.judging.teamRubricShows === "criteria"}
                  />
                )}
              </div>
            )}

            {step === "review" && (
              <form.Subscribe selector={(state) => state.values}>
                {(values) => (
                  <ReviewStep
                    form={definition}
                    values={values}
                    files={files}
                    team={team}
                    blind={blind}
                    missing={missingItems(
                      values,
                      definition,
                      files,
                      team.members,
                      event.team_size_min,
                      t,
                    )}
                    onFix={() => void goTo("project")}
                    visibility={
                      <fieldset disabled={!editable}>
                        <Screen.Section title={t("sub.visibility")}>
                          <form.Field name="isPublic">
                            {(field) => (
                              <field.SwitchField
                                disabled={publicLocked}
                                description={publicLocked ? t("sub.publicLocked") : undefined}
                              />
                            )}
                          </form.Field>
                        </Screen.Section>
                      </fieldset>
                    }
                  />
                )}
              </form.Subscribe>
            )}

            <div className="flex flex-col gap-3">
              <form.FormAlert title={t("sub.notSubmittedYet")} />
              <div className="flex flex-wrap items-center gap-2">
                {index > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const key = steps[index - 1]?.key;
                      if (key) void goTo(key);
                    }}
                  >
                    <IconArrowLeft />
                    {t("sub.back")}
                  </Button>
                )}
                {nextStep &&
                  (editable ? (
                    <form.Submit
                      pending={`${t("sub.saving")}...`}
                      onClick={() => (intent.current = "next")}
                    >
                      {t("sub.next")}
                      <IconArrowRight />
                    </form.Submit>
                  ) : (
                    <Button type="button" onClick={() => void goTo(nextStep)}>
                      {t("sub.next")}
                      <IconArrowRight />
                    </Button>
                  ))}
                {!nextStep && editable && !submitted && (
                  <form.Submit
                    pending={`${t("sub.submitting")}...`}
                    onClick={() => (intent.current = "submit")}
                  >
                    {t("sub.submit")}
                  </form.Submit>
                )}
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-(--layout-offset) lg:self-start">
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                const missing = missingItems(
                  values,
                  definition,
                  files,
                  team.members,
                  event.team_size_min,
                  t,
                );
                return (
                  <Steps
                    title={t("sub.ready")}
                    onJump={jump}
                    steps={[
                      {
                        key: "title",
                        title: t("sub.missingTitle"),
                        done: !!values.title.trim(),
                        target: "title",
                      },
                      ...definition.items
                        .filter((item) => item.required)
                        .map((item) => ({
                          key: item.key,
                          title: item.label,
                          done: !missing.includes(item.label),
                          target: item.kind === "file" ? `file-${item.key}` : `answers.${item.key}`,
                        })),
                      ...(event.team_size_min > 1
                        ? [
                            {
                              key: "team",
                              title: t("sub.teamMembersStep", { count: event.team_size_min }),
                              done: team.members >= event.team_size_min,
                              description: t("sub.youHave", { count: team.members }),
                            },
                          ]
                        : []),
                    ]}
                  />
                );
              }}
            </form.Subscribe>
            <ErrorAlert error={unsubmit.error} title={t("sub.takeBackFailed")} />
            {editable && (
              <div className="flex flex-col gap-2">
                <form.Submit
                  variant="secondary"
                  pending={`${t("sub.saving")}...`}
                  onClick={() => (intent.current = "save")}
                >
                  {submitted ? t("sub.saveChanges") : t("sub.saveDraft")}
                </form.Submit>
                {submitted && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={unsubmit.isPending}
                    onClick={() => unsubmit.mutate()}
                  >
                    {t("sub.takeBack")}
                  </Button>
                )}
              </div>
            )}
            <GalleryLook submission={submission} files={files} />
            <DeleteSubmission submission={submission} open={open} onDone={refresh} />
          </aside>
        </form.Form>
      </form.AppForm>
    </div>
  );
}

function TeamRubric({
  submissionId,
  editable,
  showCriteria,
}: {
  submissionId: string;
  editable: boolean;
  showCriteria: boolean;
}) {
  const t = useT();
  const eventId = useEvent().id;
  const { data: rubrics = [] } = useQuery(rubricsQueryOptions(eventId));
  const { data: picked = NO_PROJECT_RUBRIC } = useQuery(submissionRubricQueryOptions(submissionId));
  const { data: criteria } = useQuery({ ...criteriaQueryOptions(eventId), enabled: showCriteria });
  if (rubrics.length === 0) return null;
  return (
    <RubricPicker
      submissionId={submissionId}
      rubrics={rubrics}
      value={picked}
      editable={editable}
      criteria={showCriteria ? criteria : undefined}
      description={t("rubric.teamHelp")}
    />
  );
}

function FileItem({
  item,
  submission,
  teamId,
  files,
  disabled,
  onChanged,
}: {
  item: SubmissionForm["items"][number];
  submission: Submission;
  teamId: string;
  files: Tuple<SubmissionFile>;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const event = useEvent();
  const [problem, setProblem] = useState<string | null>(null);
  const maxMb = useUploadMb(event.id, item.maxMb ?? 50);
  const upload = useMutation({
    mutationFn: async (picked: File[]) => {
      const tooBig = picked.find((file) => file.size > maxMb * 1024 * 1024);
      if (tooBig) throw new Error(t("sub.fileTooBig", { name: tooBig.name, mb: maxMb }));
      for (const file of picked) {
        const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
        const path = `${event.id}/${teamId}/${submission.form_id}/${crypto.randomUUID()}-${safe}`;
        const { error } = await browserClient().storage.from("submissions").upload(path, file);
        if (error)
          throw new Error(t("sub.uploadFailed", { name: file.name, reason: error.message }));
        unwrap(
          await addSubmissionFileFn({
            data: {
              eventId: event.id,
              submissionId: submission.id,
              itemKey: item.key,
              storagePath: path,
              fileName: file.name,
              sizeBytes: file.size,
            },
          }),
        );
      }
    },
    onMutate: () => setProblem(null),
    onError: (error) => setProblem(error.message),
    onSettled: onChanged,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await removeSubmissionFileFn({ data: id })),
    onError: (error) => setProblem(error.message),
    onSettled: onChanged,
  });

  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={`file-${item.key}`} required={item.required}>
        {item.label}
      </FieldLabel>
      <FileDrop
        id={`file-${item.key}`}
        files={files.map((file) => ({
          id: file.id,
          name: file.file_name,
          sizeBytes: file.size_bytes,
        }))}
        accept={item.accept}
        maxMb={maxMb}
        busy={upload.isPending || remove.isPending}
        disabled={disabled}
        invalid={!!problem}
        onAdd={(picked) => upload.mutate(picked)}
        onRemove={(id) => remove.mutate(id)}
      />
      {item.help && <FieldDescription>{item.help}</FieldDescription>}
      {problem && <FieldError>{problem}</FieldError>}
    </Field>
  );
}

function DeleteSubmission({
  submission,
  open,
  onDone,
}: {
  submission: Submission;
  open: boolean;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const event = useEvent();
  const locale = useLocale();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["submissions"]),
  );
  const policy = settings.submissions.deletion;
  const remove = useMutation({
    mutationFn: async () => unwrap(await deleteSubmissionFn({ data: submission.id })),
    onSuccess: onDone,
  });
  const withdraw = useMutation({
    mutationFn: async () => unwrap(await cancelSubmissionDeletionFn({ data: submission.id })),
    onSuccess: onDone,
  });
  const error = <ErrorAlert error={remove.error ?? withdraw.error} title={t("sub.couldntDo")} />;

  if (submission.deletion_requested_at) {
    return (
      <div className="flex flex-col gap-2">
        <Alert>
          <AlertTitle>{t("sub.deletionRequested")}</AlertTitle>
          <AlertDescription>
            {t("sub.deletionBody", {
              when: formatRelative(submission.deletion_requested_at, undefined, locale),
            })}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="ghost"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate()}
        >
          {t("sub.withdrawRequest")}
        </Button>
        {error}
      </div>
    );
  }
  if (submission.status === "disqualified" || policy === "none") return null;
  if (policy === "allow" && !open) return null;

  const title = submission.title || t("sub.thisSubmission");
  return (
    <div className="flex flex-col gap-2">
      {policy === "allow" ? (
        <Button
          variant="ghost-destructive"
          disabled={remove.isPending}
          confirm={{
            title: t("sub.deleteTitle", { name: title }),
            description: t("sub.deleteBody"),
            label: t("sub.deleteLabel"),
          }}
          onClick={() => remove.mutate()}
        >
          {t("sub.deleteButton")}...
        </Button>
      ) : (
        <Button
          variant="ghost-destructive"
          disabled={remove.isPending}
          confirm={{
            title: t("sub.askTitle", { name: title }),
            description: t("sub.askBody"),
            label: t("sub.askLabel"),
          }}
          onClick={() => remove.mutate()}
        >
          {t("sub.askButton")}...
        </Button>
      )}
      {error}
    </div>
  );
}
