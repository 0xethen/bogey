import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  assignJudgesFn,
  criteriaQueryOptions,
  judgingProgressQueryOptions,
  previewResultsQueryOptions,
  saveCriteriaFn,
  rubricsQueryOptions,
  type Criterion,
  type Rubric,
} from "@bogey/db/queries/judging";
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
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { CriterionField } from "#/components/event/judging/criterion-field.tsx";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { Screen } from "@bogey/ui/components/screen";
import { IconClipboardCheck, IconGavel, IconHourglass, IconPlus } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { Calibration, ManualAssignments } from "./-components/fairness.tsx";
import { AssignmentRules, assignmentQueries } from "./-components/assignment-rules.tsx";
import { Rounds } from "./-components/rounds.tsx";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging")({
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
      searchSection(t("manageJudging.criteria"), {
        keywords: ["rubric", "rubrics", "themes", "scores", "weights"],
        id: "criteria",
      }),
      ...searchSettings("judging", ["judgeRubric", "teamRubric", "teamRubricShows"], t),
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
      context.query.ensureQueryData(criteriaQueryOptions(context.event.id)),
      context.query.ensureQueryData(rubricsQueryOptions(context.event.id)),
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
      <CriteriaEditor />
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

const criterionSchema = (t: T) =>
  z.object({
    uid: z.string(),
    id: z.string(),
    label: z
      .string()
      .trim()
      .min(1, t("manageJudging.nameIt"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("checkin.name"), placeholder: t("manageJudging.namePlaceholder") }),
    description: z
      .string()
      .max(2000, t("form.maxLength", { max: 2000 }))
      .meta({
        label: t("manageJudging.guidance"),
        placeholder: t("manageJudging.guidancePlaceholder"),
      }),
    range: z
      .tuple([z.union([z.number(), z.nan()]), z.union([z.number(), z.nan()])])
      .superRefine(([low, high], ctx) => {
        if (!Number.isInteger(low) || !Number.isInteger(high)) {
          ctx.addIssue({ code: "custom", message: t("manageJudging.rangeWhole") });
        } else if (low < 0 || high > 100) {
          ctx.addIssue({ code: "custom", message: t("manageJudging.rangeBounds") });
        } else if (low >= high) {
          ctx.addIssue({ code: "custom", message: t("manageJudging.rangeOrder") });
        }
      })
      .meta({ label: t("manageJudging.scores") }),
    weight: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, t("manageJudging.weightRule"))
      .refine((value) => Number(value) > 0, t("manageJudging.weightPositive"))
      .meta({ label: t("manageJudging.weight") }),
    roundId: z.string().meta({ label: t("manageJudging.countsIn") }),
    rubricId: z.string().meta({ label: t("rubric.label") }),
  });

const rubricSchema = (t: T) =>
  z.object({
    id: z.string(),
    name: z
      .string()
      .trim()
      .min(1, t("rubric.nameIt"))
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("checkin.name"), placeholder: t("rubric.namePlaceholder") }),
    description: z
      .string()
      .max(2000, t("form.maxLength", { max: 2000 }))
      .meta({ label: t("manageJudging.guidance"), placeholder: t("rubric.guidancePlaceholder") }),
  });

const criteriaSchema = (t: T) =>
  z.object({
    rubrics: z
      .array(rubricSchema(t))
      .max(20, t("rubric.atMost"))
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          const key = item.name.trim().toLowerCase();
          if (key && seen.has(key)) {
            ctx.addIssue({ code: "custom", path: [index, "name"], message: t("rubric.sameName") });
          }
          seen.add(key);
        });
      }),
    items: z
      .array(criterionSchema(t))
      .max(60, t("manageJudging.atMostCriteria"))
      .superRefine((items, ctx) => {
        const seen = new Map<string, number>();
        items.forEach((item, index) => {
          const key = item.label.trim().toLowerCase();
          if (key && seen.has(key)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "label"],
              message: t("manageJudging.sameName"),
            });
          }
          seen.set(key, index);
        });
      }),
  });

const ROUND_ALL = "all";
const RUBRIC_ALL = "all";

type CriterionValues = z.infer<ReturnType<typeof criterionSchema>>;

const toValues = (criterion: Criterion): CriterionValues => ({
  uid: criterion.id,
  id: criterion.id,
  label: criterion.label,
  description: criterion.description_md,
  range: [criterion.min_score, criterion.max_score],
  weight: String(Number(criterion.weight)),
  roundId: criterion.round_id ?? ROUND_ALL,
  rubricId: criterion.rubric_id ?? RUBRIC_ALL,
});

const toRubricValues = (rubric: Rubric) => ({
  id: rubric.id,
  name: rubric.name,
  description: rubric.description_md,
});

function copyLabel(label: string, taken: Tuple<string>, t: T): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const base = label.trim() || t("manageJudging.criterion");
  for (let n = 1; ; n++) {
    const name =
      n === 1 ? t("manageJudging.copyOf", { base }) : t("manageJudging.copyOfN", { base, n });
    if (!used.has(name.toLowerCase())) return name.slice(0, 80);
  }
}

function unfinished(item: CriterionValues, schema: ReturnType<typeof criterionSchema>): boolean {
  return !schema.safeParse(item).success;
}

function CriteriaEditor() {
  const t = useT();
  const schema = useMemo(() => criteriaSchema(t), [t]);
  const itemSchema = useMemo(() => criterionSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: criteria } = useSuspenseQuery(criteriaQueryOptions(event.id));
  const { data: rubrics } = useSuspenseQuery(rubricsQueryOptions(event.id));
  const { data: roundData } = useSuspenseQuery(judgingRoundsQueryOptions(event.id));
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  const roundOptions: Tuple<{ value: string; label: string }> = [
    { value: ROUND_ALL, label: t("manageJudging.everyRound") },
    ...roundData.rounds.map((round) => ({
      value: round.id,
      label: t("manageJudging.roundOf", {
        form: forms.find((form) => form.id === round.formId)?.title ?? t("tablesEditor.form"),
        round: round.name,
      }),
    })),
  ];
  const multiRound = roundData.rounds.some((round) => round.ordinal > 1);
  const [removed, setRemoved] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { rubrics: rubrics.map(toRubricValues), items: criteria.map(toValues) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await saveCriteriaFn({
        data: {
          eventId: event.id,
          items: value.items.map((item) => ({
            id: item.id || null,
            label: item.label.trim(),
            descriptionMd: item.description,
            minScore: item.range[0],
            maxScore: item.range[1],
            weight: Number(item.weight),
            roundId: item.roundId === ROUND_ALL ? null : item.roundId,
            rubricId: item.rubricId === RUBRIC_ALL ? null : item.rubricId,
          })),
          rubrics: value.rubrics.map((rubric) => ({
            id: rubric.id,
            name: rubric.name.trim(),
            descriptionMd: rubric.description,
          })),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setRemoved(result.data);
      await queryClient.invalidateQueries({
        queryKey: previewResultsQueryOptions(event.id).queryKey,
      });
      const [saved, savedRubrics] = await Promise.all([
        queryClient.fetchQuery({ ...criteriaQueryOptions(event.id), staleTime: 0 }),
        queryClient.fetchQuery({ ...rubricsQueryOptions(event.id), staleTime: 0 }),
      ]);
      formApi.reset({ rubrics: savedRubrics.map(toRubricValues), items: saved.map(toValues) });
      return undefined;
    },
  });

  return (
    <Screen.Section
      id="criteria"
      title={t("manageJudging.criteria")}
      description={t("manageJudging.criteriaHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="rubrics">
            {(list) =>
              list.value.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium">{t("rubric.title")}</h4>
                  <EditableList onMove={(from, to) => list.moveValue(from, to)}>
                    {list.value.map((rubric, index) => (
                      <EditableListItem
                        key={rubric.id}
                        id={rubric.id}
                        index={index}
                        noun={t("rubric.noun")}
                        onRemove={() => {
                          list.removeValue(index);
                          form.setFieldValue(
                            "items",
                            form
                              .getFieldValue("items")
                              .filter((item) => item.rubricId !== rubric.id),
                          );
                        }}
                        confirmRemove={t("rubric.removeWarning")}
                        preview={
                          <div className="flex flex-col gap-1">
                            <p className="font-medium">
                              {rubric.name.trim() || t("rubric.numbered", { n: index + 1 })}
                            </p>
                            {rubric.description && (
                              <p className="text-sm text-muted-fg">{rubric.description}</p>
                            )}
                          </div>
                        }
                        editing={active === rubric.id || !rubric.name.trim()}
                        onEdit={() => setActive(rubric.id)}
                        onDone={() => setActive(null)}
                      >
                        <form.Field name={`rubrics[${index}].name`}>
                          {(field) => <field.TextField required />}
                        </form.Field>
                        <form.Field name={`rubrics[${index}].description`}>
                          {(field) => <field.TextField />}
                        </form.Field>
                      </EditableListItem>
                    ))}
                  </EditableList>
                  <h4 className="pt-2 text-sm font-medium">{t("manageJudging.criteria")}</h4>
                </div>
              )
            }
          </form.Field>
          <form.Field name="items">
            {(list) => (
              <>
                <EditableList
                  onMove={(from, to) => list.moveValue(from, to)}
                  empty={t("manageJudging.noCriteria")}
                >
                  {list.value.map((item, index) => (
                    <EditableListItem
                      key={item.uid}
                      id={item.uid}
                      index={index}
                      noun={t("manageJudging.criterionNoun")}
                      onRemove={() => list.removeValue(index)}
                      onDuplicate={() => {
                        const uid = crypto.randomUUID();
                        list.insertValue(index + 1, {
                          ...item,
                          uid,
                          id: "",
                          label: copyLabel(
                            item.label,
                            list.value.map((other) => other.label),
                            t,
                          ),
                        });
                        setActive(uid);
                      }}
                      confirmRemove={item.id ? t("manageJudging.removeWarning") : undefined}
                      preview={
                        <CriterionField
                          criterion={{
                            id: item.uid,
                            label: item.label.trim(),
                            descriptionMd: item.description,
                            minScore: Number.isInteger(item.range[0]) ? item.range[0] : 0,
                            maxScore: Number.isInteger(item.range[1]) ? item.range[1] : 10,
                          }}
                          value={null}
                          onChange={() => {}}
                        />
                      }
                      editing={active === item.uid || unfinished(item, itemSchema)}
                      onEdit={() => setActive(item.uid)}
                      onDone={() => setActive(null)}
                    >
                      <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
                        <form.Field name={`items[${index}].label`}>
                          {(field) => <field.TextField required />}
                        </form.Field>
                        <form.Field name={`items[${index}].weight`}>
                          {(field) => <field.TextField required />}
                        </form.Field>
                      </div>
                      <form.Field name={`items[${index}].range`}>
                        {(field) => (
                          <field.RangeField
                            required
                            labels={[t("manageJudging.lowest"), t("manageJudging.top")]}
                          />
                        )}
                      </form.Field>
                      <form.Subscribe selector={(state) => state.values.rubrics}>
                        {(named) =>
                          named.length > 0 && (
                            <form.Field name={`items[${index}].rubricId`}>
                              {(field) => (
                                <field.Field>
                                  <field.Label />
                                  <FieldSelect
                                    field={field}
                                    options={[
                                      { value: RUBRIC_ALL, label: t("rubric.every") },
                                      ...named.map((rubric, at) => ({
                                        value: rubric.id,
                                        label:
                                          rubric.name.trim() || t("rubric.numbered", { n: at + 1 }),
                                      })),
                                    ]}
                                  />
                                </field.Field>
                              )}
                            </form.Field>
                          )
                        }
                      </form.Subscribe>
                      {multiRound && (
                        <form.Field name={`items[${index}].roundId`}>
                          {(field) => (
                            <field.Field>
                              <field.Label />
                              <FieldSelect field={field} options={roundOptions} />
                            </field.Field>
                          )}
                        </form.Field>
                      )}
                      <form.Field name={`items[${index}].description`}>
                        {(field) => <field.TextField />}
                      </form.Field>
                    </EditableListItem>
                  ))}
                </EditableList>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({
                        uid,
                        id: "",
                        label: "",
                        description: "",
                        range: [0, 10],
                        weight: "1",
                        roundId: ROUND_ALL,
                        rubricId: RUBRIC_ALL,
                      });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("manageJudging.addCriterion")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      const id = crypto.randomUUID();
                      form.pushFieldValue("rubrics", { id, name: "", description: "" });
                      setActive(id);
                    }}
                  >
                    <IconPlus />
                    {t("rubric.add")}
                  </Button>
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title={t("manageJudging.saveFailed")} />
          {removed !== null && removed > 0 && (
            <p role="status" className="text-sm text-muted-fg">
              {t("manageJudging.savedRemoved", { count: removed })}
            </p>
          )}
        </form.Form>
      </form.AppForm>
      {rubrics.length > 0 && (
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="judging"
          keys={["judgeRubric", "teamRubric", "teamRubricShows"]}
        />
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
