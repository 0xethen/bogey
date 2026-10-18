import { useMemo, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { JudgingAssignment } from "@bogey/config/settings";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import {
  ownSettingsQueryOptions,
  settingsQueryOptions,
  updateSettings,
} from "@bogey/db/queries/settings";
import { tagsQueryOptions, type Tag } from "@bogey/db/queries/tags";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  schemaMetaOf,
  useAppForm,
} from "@bogey/ui/lib/form";
import { TagBadge } from "#/components/tags/tags.tsx";
import { useT, type T } from "#/lib/translate.tsx";

const ANY_DIVISION = "any";

export function assignmentQueries(event: { id: string; org_id: string }) {
  return {
    settings: settingsQueryOptions({ eventId: event.id }, ["judging", "tags"]),
    tags: tagsQueryOptions({ orgId: event.org_id, eventId: event.id }),
  };
}

const ruleSchema = (t: T) =>
  z.object({
    uid: z.string(),
    tag: z
      .string()
      .min(1, t("assignRules.pickTag"))
      .meta({ label: t("assignRules.tag") }),
    count: z
      .number(t("orgLimit.enterNumber"))
      .int(t("eventForm.whole"))
      .min(1, t("eventForm.atLeast", { min: 1 }))
      .max(10, t("eventForm.atMost", { max: 10 }))
      .meta({ label: t("assignRules.count") }),
    division: z.string().meta({ label: t("assignRules.division") }),
    strict: z
      .boolean()
      .meta({ label: t("assignRules.strict") })
      .describe(t("assignRules.strictHelp")),
  });
type RuleValues = z.infer<ReturnType<typeof ruleSchema>>;

const assignmentSchema = (t: T) =>
  z.object({
    perProject: z
      .number(t("orgLimit.enterNumber"))
      .int(t("eventForm.whole"))
      .min(1, t("eventForm.atLeast", { min: 1 }))
      .max(20, t("eventForm.atMost", { max: 20 }))
      .meta({ label: t("manageJudging.perProject") }),
    rules: z.array(ruleSchema(t)).max(10, t("assignRules.atMost10")),
    exclude: z
      .array(z.string())
      .max(20)
      .meta({ label: t("assignRules.exclude"), placeholder: t("assignRules.excludeNone") })
      .describe(t("assignRules.excludeHelp")),
  });
type AssignmentValues = z.infer<ReturnType<typeof assignmentSchema>>;

const toValues = (assignment: JudgingAssignment): AssignmentValues => ({
  perProject: assignment.perProject,
  rules: assignment.rules.map((rule) => ({
    uid: crypto.randomUUID(),
    tag: rule.tag,
    count: rule.count,
    division: rule.division ?? ANY_DIVISION,
    strict: rule.strict,
  })),
  exclude: [...assignment.exclude],
});

const fromValues = (values: AssignmentValues): JudgingAssignment => ({
  perProject: values.perProject,
  rules: values.rules.map((rule) => ({
    tag: rule.tag,
    count: rule.count,
    strict: rule.strict,
    division: rule.division === ANY_DIVISION ? null : rule.division,
  })),
  exclude: values.exclude,
});

/** Judges per project and the tag rules Assign judges follows (judging.assignment). */
export function AssignmentRules({ event }: { event: { id: string; org_id: string } }) {
  const t = useT();
  const schema = useMemo(() => assignmentSchema(t), [t]);
  const itemSchema = useMemo(() => ruleSchema(t), [t]);
  const queryClient = useQueryClient();
  const queries = assignmentQueries(event);
  const { data: settings } = useSuspenseQuery(queries.settings);
  const { data: allTags } = useSuspenseQuery(queries.tags);
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const tags = allTags.filter((tag) => !tag.event_id || settings.tags.eventTags);
  const [active, setActive] = useState<string | null>(null);
  const scope = { scope: "event", eventId: event.id } as const;

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: toValues(settings.judging.assignment),
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await updateSettings(scope, "judging", { assignment: fromValues(value) });
      if (!result.ok) return createValidationError(result.error.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queries.settings.queryKey }),
        queryClient.invalidateQueries({
          queryKey: ownSettingsQueryOptions(scope, "judging").queryKey,
        }),
      ]);
      formApi.reset(value);
      setActive(null);
      return undefined;
    },
  });

  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));
  const divisionOptions = [
    { value: ANY_DIVISION, label: t("assignRules.anyDivision") },
    ...divisions.map((division) => ({ value: division.id, label: division.name })),
  ];

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-4">
        <form.Field name="perProject">
          {(field) => <field.NumberField min={1} max={20} />}
        </form.Field>
        <form.Field name="rules">
          {(list) => (
            <Field>
              <FieldLabel>{t("assignRules.title")}</FieldLabel>
              <p className="text-sm text-muted-fg">
                {tags.length === 0 ? t("assignRules.noTags") : t("assignRules.intro")}
              </p>
              {tags.length > 0 && (
                <>
                  <EditableList
                    onMove={(from, to) => list.moveValue(from, to)}
                    empty={t("assignRules.none")}
                  >
                    {list.value.map((rule, index) => (
                      <EditableListItem
                        key={rule.uid}
                        id={rule.uid}
                        index={index}
                        noun={t("assignRules.noun")}
                        numbered={false}
                        onRemove={() => list.removeValue(index)}
                        preview={
                          <RulePreview
                            rule={rule}
                            tags={tags}
                            division={divisions.find((each) => each.id === rule.division)?.name}
                          />
                        }
                        editing={active === rule.uid || !itemSchema.safeParse(rule).success}
                        onEdit={() => setActive(rule.uid)}
                        onDone={() => setActive(null)}
                      >
                        <form.Field name={`rules[${index}].tag`}>
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                {schemaMetaOf(field).label}
                              </FieldLabel>
                              <FieldSelect
                                field={field}
                                options={tagOptions}
                                placeholder={t("assignRules.pickTag")}
                              />
                              <field.Error />
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name={`rules[${index}].count`}>
                          {(field) => <field.NumberField min={1} max={10} />}
                        </form.Field>
                        {divisions.length > 0 && (
                          <form.Field name={`rules[${index}].division`}>
                            {(field) => (
                              <Field>
                                <FieldLabel htmlFor={field.name}>
                                  {schemaMetaOf(field).label}
                                </FieldLabel>
                                <FieldSelect field={field} options={divisionOptions} />
                              </Field>
                            )}
                          </form.Field>
                        )}
                        <form.Field name={`rules[${index}].strict`}>
                          {(field) => <field.SwitchField />}
                        </form.Field>
                      </EditableListItem>
                    ))}
                  </EditableList>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const uid = crypto.randomUUID();
                        list.pushValue({
                          uid,
                          tag: "",
                          count: 1,
                          division: ANY_DIVISION,
                          strict: false,
                        });
                        setActive(uid);
                      }}
                    >
                      <IconPlus />
                      {t("assignRules.add")}
                    </Button>
                  </div>
                </>
              )}
            </Field>
          )}
        </form.Field>
        {tags.length > 0 && (
          <form.Field name="exclude">
            {(field) => <field.MultiSelectField options={tagOptions} />}
          </form.Field>
        )}
        <form.FormAlert title={t("assignRules.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}

function RulePreview({
  rule,
  tags,
  division,
}: {
  rule: RuleValues;
  tags: Tuple<Tag>;
  division: string | undefined;
}) {
  const t = useT();
  const tag = tags.find((each) => each.id === rule.tag);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("assignRules.needs", { count: rule.count })}</span>
        {tag ? (
          <TagBadge tag={tag} />
        ) : (
          <span className="text-muted-fg">{t("assignRules.pickTag")}</span>
        )}
        {rule.strict && <Badge variant="outline">{t("assignRules.strictBadge")}</Badge>}
      </div>
      <p className="text-xs text-muted-fg">
        {division ? t("assignRules.inDivision", { division }) : t("assignRules.everyProject")}
        {" · "}
        {rule.strict ? t("assignRules.strictSummary") : t("assignRules.looseSummary")}
      </p>
    </div>
  );
}
