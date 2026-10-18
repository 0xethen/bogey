import { exportHref } from "#/lib/exports.ts";
import { ProjectExport } from "#/components/event/project-export.tsx";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  assignJudgesFn,
  criteriaQueryOptions,
  judgingProgressQueryOptions,
  previewResultsQueryOptions,
  publishResultsFn,
  saveCriteriaFn,
  rubricsQueryOptions,
  type Criterion,
  type Rubric,
  groupResults,
} from "@bogey/db/queries/judging";
import {
  eventConflictsQueryOptions,
  judgeCalibrationQueryOptions,
} from "@bogey/db/queries/conflicts";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import { eventFlagsQueryOptions } from "@bogey/db/queries/deliberation";
import { flagReason } from "#/components/event/judging/deliberation.tsx";
import { LinkRow } from "@bogey/ui/components/link-row";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { voteCountsQueryOptions } from "@bogey/db/queries/votes";
import { tableListQueryOptions } from "@bogey/db/queries/expo";
import { judgingRoundsQueryOptions } from "@bogey/db/queries/judging";
import { draftAwardsQueryOptions } from "@bogey/db/queries/awards";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { eventEntriesQueryOptions, eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { CriterionField } from "#/components/event/judging/criterion-field.tsx";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { RankedList } from "#/components/event/judging/ranked-list.tsx";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { Screen } from "@bogey/ui/components/screen";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import {
  IconAlertTriangle,
  IconClipboardCheck,
  IconGavel,
  IconHourglass,
  IconPlus,
  IconDownload,
} from "@tabler/icons-react";
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
import { Tables } from "./-components/tables.tsx";
import { Calibration, Conflicts } from "./-components/fairness.tsx";
import { AssignmentRules, assignmentQueries } from "./-components/assignment-rules.tsx";
import { Rounds } from "./-components/rounds.tsx";
import { pluginRankingMethods } from "@bogey/plugins";
import { AwardsEditor } from "./-components/awards-editor.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging")({
  staticData: {
    title: msg("judging.title"),
    settings: (t) => [
      searchSection(t("manageJudging.see"), { id: "what-judges-see" }),
      ...searchSettings("judging", ["blind", "judgeExport"], t),
      searchSection(t("manageJudging.rounds"), { id: "rounds" }),
      searchSection(t("tablesEditor.title"), { keywords: ["tables", "booths"], id: "expo-tables" }),
      searchSection(t("manageJudging.publishing"), { id: "publishing" }),
      ...searchSettings("judging", ["normalize", "minJudges", "showRankings", "shareWithTeams"], t),
      searchSection(t("manageJudging.vote"), {
        keywords: ["people's choice", "voting"],
        id: "popular-vote",
      }),
      ...searchSettings("voting", ["enabled", "who", "votesPerPerson", "ownTeam", "showCounts"], t),
      searchSection(t("manageJudging.progress"), {
        keywords: ["assign judges", "judging rules", "tags", "adult judge", "student judge"],
        id: "progress",
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
      searchSection(t("manageJudging.conflicts"), {
        keywords: ["conflict of interest"],
        id: "conflicts",
      }),
      searchSection(t("manageJudging.howScore"), {
        keywords: ["calibration"],
        id: "how-judges-score",
      }),
      searchSection(t("results.title"), { keywords: ["ranking", "publish"], id: "results" }),
      searchSection(t("results.awards"), { keywords: ["winners", "places"], id: "awards" }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(criteriaQueryOptions(context.event.id)),
      context.query.ensureQueryData(rubricsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventFlagsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingProgressQueryOptions(context.event.id)),
      context.query.ensureQueryData(previewResultsQueryOptions(context.event.id)),
      context.query.ensureQueryData(draftAwardsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(voteCountsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventConflictsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgeCalibrationQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventTeamsQueryOptions(context.event.id)),
      context.query.ensureQueryData(tableListQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPrizesQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventEntriesQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(assignmentQueries(context.event).settings),
      context.query.ensureQueryData(assignmentQueries(context.event).tags),
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
  const { event, plugins } = Route.useRouteContext();
  const { data: rows } = useSuspenseQuery(previewResultsQueryOptions(event.id));
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
      <Rounds eventId={event.id} plugins={plugins} />
      <Conflicts eventId={event.id} />
      <Calibration eventId={event.id} />
      <Tables eventId={event.id} slug={event.slug} />
      <CriteriaEditor />
      <Deliberation />
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

function Results() {
  const t = useT();
  const { event, plugins } = Route.useRouteContext();
  const methods = pluginRankingMethods(plugins);
  const methodLabel = (id: string) => methods.find((each) => each.id === id)?.label ?? id;
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
            <RankedList
              label={t("results.rankingOf", { form: formTitle })}
              entries={formRows.map((row) => ({
                key: row.submissionId,
                rank: row.rank,
                title: row.title,
                subtitle: row.teamName,
                value: row.score ?? "–",
                detail: [
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
                  .join(" · "),
              }))}
            />
          </div>
        ))
      )}
    </Screen.Section>
  );
}
