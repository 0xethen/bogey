import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  criteriaQueryOptions,
  judgingRoundsQueryOptions,
  previewResultsQueryOptions,
  rubricDivisionsQueryOptions,
  rubricsQueryOptions,
  saveCriteriaFn,
  type Criterion,
  type Rubric,
  type RubricDivision,
} from "@bogey/db/queries/judging";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { requestFailure } from "@bogey/db/errors";
import { toCsv } from "@bogey/utils/csv";
import {
  evenBands,
  MAX_BANDS,
  nextBand,
  overlappingBands,
  readGuidance,
  readGuidanceTable,
  sortBands,
  type GuidanceProblem,
  type GuidanceRow,
} from "@bogey/utils/guidance";
import { parseTable } from "@bogey/utils/roster";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { Screen } from "@bogey/ui/components/screen";
import { IconDownload, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { CriterionField } from "#/components/event/judging/criterion-field.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/judging/criteria")({
  staticData: {
    title: msg("manageNav.criteria"),
    settings: (t) => [
      searchSection(t("manageJudging.criteria"), {
        keywords: ["scores", "weights", "guidance", "score bands", "ranges"],
        id: "criteria",
      }),
      searchSection(t("criteriaImport.title"), {
        keywords: ["upload", "csv", "spreadsheet", "excel", "xlsx"],
        id: "import",
      }),
      searchSection(t("rubric.title"), {
        keywords: ["themes", "divisions", "tracks"],
        id: "rubrics",
      }),
      ...searchSettings("judging", ["judgeRubric", "teamRubric", "teamRubricShows"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(criteriaQueryOptions(context.event.id)),
      context.query.ensureQueryData(rubricsQueryOptions(context.event.id)),
      context.query.ensureQueryData(rubricDivisionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(judgingRoundsQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "judging",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const MAX_CRITERIA = 60;
const ROUND_ALL = "all";
const RUBRIC_ALL = "all";
const ACCEPT = ".csv,.tsv,.txt,.xlsx";

const whole = (t: T) =>
  z.union([z.number(), z.nan()]).refine(Number.isInteger, t("guidance.whole"));

const bandSchema = (t: T) =>
  z.object({
    uid: z.string(),
    min: whole(t).meta({ label: t("guidance.from") }),
    max: whole(t).meta({ label: t("guidance.to") }),
    body: z
      .string()
      .trim()
      .min(1, t("guidance.describe"))
      .max(2000, t("form.maxLength", { max: 2000 }))
      .meta({ label: t("guidance.body"), placeholder: t("guidance.bodyPlaceholder") }),
  });

const criterionSchema = (t: T) =>
  z
    .object({
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
          label: t("manageJudging.description"),
          placeholder: `${t("manageJudging.guidancePlaceholder")}...`,
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
      guidance: z.array(bandSchema(t)).max(MAX_BANDS, t("guidance.atMost")),
    })
    .superRefine((item, ctx) => {
      const [low, high] = item.range;
      const ranged = Number.isInteger(low) && Number.isInteger(high);
      item.guidance.forEach((band, index) => {
        if (!Number.isInteger(band.min) || !Number.isInteger(band.max)) return;
        if (band.min > band.max) {
          ctx.addIssue({
            code: "custom",
            path: ["guidance", index, "max"],
            message: t("guidance.order"),
          });
        } else if (ranged && (band.min < low || band.max > high)) {
          ctx.addIssue({
            code: "custom",
            path: ["guidance", index, band.min < low ? "min" : "max"],
            message: t("guidance.outside", { min: low, max: high }),
          });
        }
      });
      const checked = item.guidance.filter(
        (band) => Number.isInteger(band.min) && Number.isInteger(band.max),
      );
      for (const [, later] of overlappingBands(checked)) {
        ctx.addIssue({
          code: "custom",
          path: ["guidance", item.guidance.indexOf(checked[later]!), "min"],
          message: t("guidance.overlap"),
        });
      }
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
      .meta({
        label: t("manageJudging.description"),
        placeholder: `${t("rubric.guidancePlaceholder")}...`,
      }),
    divisionIds: z
      .array(z.string())
      .meta({ label: t("rubric.divisions"), placeholder: t("rubric.everyDivision") })
      .describe(t("rubric.divisionsHelp")),
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
      .max(MAX_CRITERIA, t("manageJudging.atMostCriteria"))
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          const key = item.label.trim().toLowerCase();
          if (key && seen.has(key)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "label"],
              message: t("manageJudging.sameName"),
            });
          }
          seen.add(key);
        });
      }),
  });

type CriterionValues = z.infer<ReturnType<typeof criterionSchema>>;
type BandValues = CriterionValues["guidance"][number];

const toValues = (criterion: Criterion): CriterionValues => ({
  uid: criterion.id,
  id: criterion.id,
  label: criterion.label,
  description: criterion.description_md,
  range: [criterion.min_score, criterion.max_score],
  weight: String(Number(criterion.weight)),
  roundId: criterion.round_id ?? ROUND_ALL,
  rubricId: criterion.rubric_id ?? RUBRIC_ALL,
  guidance: sortBands(readGuidance(criterion.guidance)).map((band) => ({
    uid: crypto.randomUUID(),
    ...band,
  })),
});

const toRubricValues = (rubric: Rubric, links: Tuple<RubricDivision>) => ({
  id: rubric.id,
  name: rubric.name,
  description: rubric.description_md,
  divisionIds: links.filter((link) => link.rubricId === rubric.id).map((link) => link.divisionId),
});

const blankCriterion = (uid: string): CriterionValues => ({
  uid,
  id: "",
  label: "",
  description: "",
  range: [0, 10],
  weight: "1",
  roundId: ROUND_ALL,
  rubricId: RUBRIC_ALL,
  guidance: [],
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

const shownBands = (bands: Tuple<BandValues>) =>
  bands.filter(
    (band) => Number.isInteger(band.min) && Number.isInteger(band.max) && band.body.trim(),
  );

function problemText(problem: GuidanceProblem, t: T): string {
  switch (problem.kind) {
    case "empty":
      return t("criteriaImport.empty");
    case "noBands":
      return t("criteriaImport.noBands");
    case "badRange":
      return t("criteriaImport.badRange", { line: problem.line, text: problem.text });
    case "noLabel":
      return t("criteriaImport.noLabel", { line: problem.line });
    case "badWeight":
      return t("criteriaImport.badWeight", { line: problem.line, text: problem.text });
    case "tooMany":
      return t("criteriaImport.tooMany", { line: problem.line, label: problem.label });
  }
}

async function fileRows(file: File): Promise<GuidanceRow[]> {
  if (!/\.xlsx$/i.test(file.name)) return parseTable(await file.text());
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  return rows.map((row, index) => ({
    line: index + 1,
    cells: row.map((cell) =>
      cell === null ? "" : cell instanceof Date ? cell.toISOString() : String(cell).trim(),
    ),
  }));
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// a row per band, in the shape the import reads back
function guidanceCsv(items: Tuple<CriterionValues>): string {
  return toCsv(
    ["Criterion", "From", "To", "Guidance"],
    items.flatMap((item) =>
      item.guidance.length
        ? item.guidance.map((band) => [item.label, band.min, band.max, band.body])
        : [[item.label, "", "", ""]],
    ),
    { bom: true },
  );
}

interface ImportNote {
  name: string;
  updated: number;
  added: number;
  problems: string[];
}

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => criteriaSchema(t), [t]);
  const itemSchema = useMemo(() => criterionSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: criteria } = useSuspenseQuery(criteriaQueryOptions(event.id));
  const { data: rubrics } = useSuspenseQuery(rubricsQueryOptions(event.id));
  const { data: links } = useSuspenseQuery(rubricDivisionsQueryOptions(event.id));
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
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
  const divisionOptions = divisions.map((division) => ({
    value: division.id,
    label: division.name,
  }));
  const divisionName = (id: string) => divisions.find((division) => division.id === id)?.name;
  const multiRound = roundData.rounds.some((round) => round.ordinal > 1);
  const [removed, setRemoved] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<ImportNote | null>(null);

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        rubrics: rubrics.map((rubric) => toRubricValues(rubric, links)),
        items: criteria.map(toValues),
      },
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
            guidance: sortBands(
              item.guidance.map((band) => ({
                min: band.min,
                max: band.max,
                body: band.body.trim(),
              })),
            ),
          })),
          rubrics: value.rubrics.map((rubric) => ({
            id: rubric.id,
            name: rubric.name.trim(),
            descriptionMd: rubric.description,
            divisionIds: rubric.divisionIds,
          })),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setRemoved(result.data);
      setNote(null);
      await queryClient.invalidateQueries({
        queryKey: previewResultsQueryOptions(event.id).queryKey,
      });
      const [saved, savedRubrics, savedLinks] = await Promise.all([
        queryClient.fetchQuery({ ...criteriaQueryOptions(event.id), staleTime: 0 }),
        queryClient.fetchQuery({ ...rubricsQueryOptions(event.id), staleTime: 0 }),
        queryClient.fetchQuery({ ...rubricDivisionsQueryOptions(event.id), staleTime: 0 }),
      ]);
      formApi.reset({
        rubrics: savedRubrics.map((rubric) => toRubricValues(rubric, savedLinks)),
        items: saved.map(toValues),
      });
      return undefined;
    },
  });

  // merges a file's criteria into the form: same-named ones take its guidance, others are added
  const load = async (file: File) => {
    setReading(true);
    setNote(null);
    try {
      const { criteria: found, problems } = readGuidanceTable(await fileRows(file));
      const items = [...form.getFieldValue("items")];
      let updated = 0;
      let added = 0;
      for (const each of found) {
        const bands = each.guidance.map((band) => ({ uid: crypto.randomUUID(), ...band }));
        const low = Math.min(...each.guidance.map((band) => band.min));
        const high = Math.max(...each.guidance.map((band) => band.max));
        const at = items.findIndex(
          (item) => item.label.trim().toLowerCase() === each.label.toLowerCase(),
        );
        if (at >= 0) {
          const item = items[at]!;
          const [from, to] = item.range;
          items[at] = {
            ...item,
            description: each.description ?? item.description,
            weight: each.weight === null ? item.weight : String(each.weight),
            guidance: bands.length ? bands : item.guidance,
            // widen the scores to fit the file's bands
            range: bands.length
              ? [Math.min(from, low), Math.max(to, high, Math.min(from, low) + 1)]
              : item.range,
          };
          updated++;
        } else if (items.length < MAX_CRITERIA) {
          const min = bands.length ? Math.min(low, 100) : 0;
          items.push({
            ...blankCriterion(crypto.randomUUID()),
            label: each.label,
            description: each.description ?? "",
            weight: each.weight === null ? "1" : String(each.weight),
            range: bands.length ? [min, Math.max(high, min + 1)] : [0, 10],
            guidance: bands,
          });
          added++;
        }
      }
      if (updated || added) form.setFieldValue("items", items);
      setNote({
        name: file.name,
        updated,
        added,
        problems: [
          ...problems.map((problem) => problemText(problem, t)),
          ...(updated + added < found.length ? [t("manageJudging.atMostCriteria")] : []),
        ],
      });
    } catch (error) {
      setNote({
        name: file.name,
        updated: 0,
        added: 0,
        problems: [
          t("criteriaImport.readFailed", {
            name: file.name,
            error: error instanceof Error ? `: ${error.message}` : "",
          }),
        ],
      });
    } finally {
      setReading(false);
    }
  };

  return (
    <Screen title={t("manageNav.criteria")} description={t("criteriaPage.intro")} width="embedded">
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-10">
          <Screen.Section
            id="criteria"
            title={t("manageJudging.criteria")}
            description={t("manageJudging.criteriaHelp")}
          >
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
                            guidance: item.guidance.map((band) => ({
                              ...band,
                              uid: crypto.randomUUID(),
                            })),
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
                              guidance: shownBands(item.guidance),
                            }}
                            value={null}
                            onChange={() => {}}
                          />
                        }
                        editing={active === item.uid || !itemSchema.safeParse(item).success}
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
                                            rubric.name.trim() ||
                                            t("rubric.numbered", { n: at + 1 }),
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
                          {(field) => <field.TextAreaField rows={2} />}
                        </form.Field>

                        <form.Field name={`items[${index}].guidance`}>
                          {(bands) => {
                            const [low, high] = item.range;
                            const ranged = Number.isInteger(low) && Number.isInteger(high);
                            const add = (band: { min: number; max: number }) =>
                              bands.pushValue({ uid: crypto.randomUUID(), body: "", ...band });
                            return (
                              <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
                                <legend className="px-1 text-sm font-medium">
                                  {t("guidance.title")}
                                </legend>
                                <p className="text-sm text-muted-fg">{t("guidance.help")}</p>
                                {bands.value.map((band, at) => (
                                  <div
                                    key={band.uid}
                                    className="grid items-start gap-2 sm:grid-cols-[5rem_5rem_1fr_auto]"
                                  >
                                    <form.Field name={`items[${index}].guidance[${at}].min`}>
                                      {(field) => <field.NumberField required min={0} max={100} />}
                                    </form.Field>
                                    <form.Field name={`items[${index}].guidance[${at}].max`}>
                                      {(field) => <field.NumberField required min={0} max={100} />}
                                    </form.Field>
                                    <form.Field name={`items[${index}].guidance[${at}].body`}>
                                      {(field) => <field.TextAreaField required rows={2} />}
                                    </form.Field>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="sm:mt-6"
                                      aria-label={t("guidance.remove")}
                                      onClick={() => bands.removeValue(at)}
                                    >
                                      <IconTrash />
                                    </Button>
                                  </div>
                                ))}
                                {ranged && bands.value.length < MAX_BANDS && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => add(nextBand(bands.value, low, high))}
                                    >
                                      <IconPlus />
                                      {t("guidance.add")}
                                    </Button>
                                    {bands.value.length === 0 &&
                                      [3, 4, 5]
                                        .filter((count) => count <= high - low + 1)
                                        .map((count) => (
                                          <Button
                                            key={count}
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => evenBands(low, high, count).forEach(add)}
                                          >
                                            {t("guidance.split", { count })}
                                          </Button>
                                        ))}
                                  </div>
                                )}
                              </fieldset>
                            );
                          }}
                        </form.Field>
                      </EditableListItem>
                    ))}
                  </EditableList>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={list.value.length >= MAX_CRITERIA}
                      tooltip={
                        list.value.length >= MAX_CRITERIA
                          ? t("common.limitReached", { max: MAX_CRITERIA })
                          : undefined
                      }
                      onClick={() => {
                        const uid = crypto.randomUUID();
                        list.pushValue(blankCriterion(uid));
                        setActive(uid);
                      }}
                    >
                      <IconPlus />
                      {t("manageJudging.addCriterion")}
                    </Button>
                  </div>
                </>
              )}
            </form.Field>
            {removed !== null && removed > 0 && (
              <p role="status" className="text-sm text-muted-fg">
                {t("manageJudging.savedRemoved", { count: removed })}
              </p>
            )}
          </Screen.Section>

          <Screen.Section
            id="import"
            title={t("criteriaImport.title")}
            description={t("criteriaImport.help")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={criteria.length === 0}
                onClick={() =>
                  download(`${event.slug}-criteria.csv`, guidanceCsv(criteria.map(toValues)))
                }
              >
                <IconDownload />
                {t("criteriaImport.download")}
              </Button>
            }
          >
            <FileDrop
              files={note ? [{ id: note.name, name: note.name, sizeBytes: 0 }] : []}
              accept={ACCEPT}
              multiple={false}
              busy={reading}
              invalid={!!note && note.updated + note.added === 0}
              onAdd={(files) => {
                const [file] = files;
                if (file) void load(file);
              }}
              onRemove={() => setNote(null)}
            />
            {note && (
              <div className="flex flex-col gap-1 text-sm" role="status">
                {note.updated + note.added > 0 && (
                  <p>
                    {t("criteriaImport.done", {
                      updated: note.updated,
                      added: note.added,
                    })}
                  </p>
                )}
                {note.problems.length > 0 && (
                  <ul className="list-disc pl-5 text-destructive">
                    {note.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Screen.Section>

          <Screen.Section
            id="rubrics"
            title={t("rubric.title")}
            description={t("criteriaPage.rubricsHelp")}
          >
            <form.Field name="rubrics">
              {(list) => (
                <>
                  <EditableList
                    onMove={(from, to) => list.moveValue(from, to)}
                    empty={t("criteriaPage.noRubrics")}
                  >
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
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">
                                {rubric.name.trim() || t("rubric.numbered", { n: index + 1 })}
                              </p>
                              {divisions.length > 0 &&
                                (rubric.divisionIds.length === 0 ? (
                                  <Badge variant="outline">{t("rubric.everyDivision")}</Badge>
                                ) : (
                                  rubric.divisionIds.map((id) => (
                                    <Badge key={id} variant="secondary">
                                      {divisionName(id) ?? t("division.untitled")}
                                    </Badge>
                                  ))
                                ))}
                            </div>
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
                        {divisions.length > 0 && (
                          <form.Field name={`rubrics[${index}].divisionIds`}>
                            {(field) => <field.MultiSelectField options={divisionOptions} />}
                          </form.Field>
                        )}
                      </EditableListItem>
                    ))}
                  </EditableList>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const id = crypto.randomUUID();
                        list.pushValue({ id, name: "", description: "", divisionIds: [] });
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
          </Screen.Section>
          <form.FormAlert title={t("manageJudging.saveFailed")} />
        </form.Form>
      </form.AppForm>

      {rubrics.length > 0 && (
        <Screen.Section id="picking-rubrics" title={t("criteriaPage.picking")}>
          <SettingFields
            scope={{ scope: "event", eventId: event.id }}
            namespace="judging"
            keys={["judgeRubric", "teamRubric", "teamRubricShows"]}
          />
        </Screen.Section>
      )}
    </Screen>
  );
}
