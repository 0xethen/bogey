import { useMemo, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { TIEBREAKERS, type Tiebreaker } from "@bogey/config/settings";
import { criteriaQueryOptions, type Criterion } from "@bogey/db/queries/judging";
import {
  ownSettingsQueryOptions,
  settingsQueryOptions,
  updateSettings,
} from "@bogey/db/queries/settings";
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
import { useT, type T } from "#/lib/translate.tsx";

type By = (typeof TIEBREAKERS)[number];

const BY_LABEL: Record<By, (t: T) => string> = {
  criterion: (t) => t("tiebreakers.by.criterion"),
  raw: (t) => t("tiebreakers.by.raw"),
  judges: (t) => t("tiebreakers.by.judges"),
  submitted: (t) => t("tiebreakers.by.submitted"),
};

export function tiebreakerQueries(event: { id: string; org_id: string }) {
  return {
    settings: settingsQueryOptions({ orgId: event.org_id, eventId: event.id }, ["judging"]),
    criteria: criteriaQueryOptions(event.id),
  };
}

const itemSchema = (t: T) =>
  z
    .object({
      uid: z.string(),
      by: z.enum(TIEBREAKERS).meta({ label: t("tiebreakers.by") }),
      criterion: z.string().meta({ label: t("tiebreakers.criterion") }),
    })
    .refine((item) => item.by !== "criterion" || item.criterion !== "", {
      message: t("tiebreakers.pickCriterion"),
      path: ["criterion"],
    });
type ItemValues = z.infer<ReturnType<typeof itemSchema>>;

const listSchema = (t: T) =>
  z.object({ tiebreakers: z.array(itemSchema(t)).max(6, t("tiebreakers.atMost6")) });
type ListValues = z.infer<ReturnType<typeof listSchema>>;

const toValues = (tiebreakers: Tuple<Tiebreaker>): ListValues => ({
  tiebreakers: tiebreakers.map((each) => ({
    uid: crypto.randomUUID(),
    by: each.by,
    criterion: each.by === "criterion" ? each.criterion : "",
  })),
});

const fromValues = (values: ListValues): Tiebreaker[] =>
  values.tiebreakers.map((each) =>
    each.by === "criterion" ? { by: "criterion", criterion: each.criterion } : { by: each.by },
  );

/** What decides between projects with the same score, in order (judging.tiebreakers). */
export function Tiebreakers({ event }: { event: { id: string; org_id: string } }) {
  const t = useT();
  const schema = useMemo(() => listSchema(t), [t]);
  const single = useMemo(() => itemSchema(t), [t]);
  const queryClient = useQueryClient();
  const queries = tiebreakerQueries(event);
  const { data: settings } = useSuspenseQuery(queries.settings);
  const { data: criteria } = useSuspenseQuery(queries.criteria);
  const [active, setActive] = useState<string | null>(null);
  const scope = { scope: "event", eventId: event.id } as const;
  const evened = settings.judging.normalize !== "none";

  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: toValues(settings.judging.tiebreakers ?? []),
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await updateSettings(scope, "judging", { tiebreakers: fromValues(value) });
      if (!result.ok) return createValidationError(result.error.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queries.settings.queryKey }),
        queryClient.invalidateQueries({
          queryKey: ownSettingsQueryOptions(scope, "judging").queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: ["results", event.id] }),
      ]);
      formApi.reset(value);
      setActive(null);
      return undefined;
    },
  });

  const byOptions = TIEBREAKERS.filter((by) => by !== "criterion" || criteria.length > 0).map(
    (by) => ({ value: by, label: BY_LABEL[by](t) }),
  );
  const criterionOptions = criteria.map((each) => ({ value: each.id, label: each.label }));

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-4">
        <form.Field name="tiebreakers">
          {(list) => (
            <Field>
              <FieldLabel>{t("tiebreakers.title")}</FieldLabel>
              <p className="text-sm text-muted-fg">{t("tiebreakers.intro")}</p>
              <EditableList
                onMove={(from, to) => list.moveValue(from, to)}
                empty={t("tiebreakers.none")}
              >
                {list.value.map((item, index) => (
                  <EditableListItem
                    key={item.uid}
                    id={item.uid}
                    index={index}
                    noun={t("tiebreakers.noun")}
                    onRemove={() => list.removeValue(index)}
                    preview={<TiebreakerPreview item={item} criteria={criteria} evened={evened} />}
                    editing={active === item.uid || !single.safeParse(item).success}
                    onEdit={() => setActive(item.uid)}
                    onDone={() => setActive(null)}
                  >
                    <form.Field name={`tiebreakers[${index}].by`}>
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor={field.name}>{schemaMetaOf(field).label}</FieldLabel>
                          <FieldSelect field={field} options={byOptions} />
                        </Field>
                      )}
                    </form.Field>
                    {item.by === "criterion" && (
                      <form.Field name={`tiebreakers[${index}].criterion`}>
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              {schemaMetaOf(field).label}
                            </FieldLabel>
                            <FieldSelect
                              field={field}
                              options={criterionOptions}
                              placeholder={t("tiebreakers.pickCriterion")}
                            />
                            <field.Error />
                          </Field>
                        )}
                      </form.Field>
                    )}
                  </EditableListItem>
                ))}
              </EditableList>
              {list.value.length < 6 && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      const by = criteria.length > 0 ? "criterion" : "judges";
                      list.pushValue({ uid, by, criterion: "" });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("tiebreakers.add")}
                  </Button>
                </div>
              )}
            </Field>
          )}
        </form.Field>
        <form.FormAlert title={t("tiebreakers.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}

function TiebreakerPreview({
  item,
  criteria,
  evened,
}: {
  item: ItemValues;
  criteria: Tuple<Criterion>;
  evened: boolean;
}) {
  const t = useT();
  const criterion = criteria.find((each) => each.id === item.criterion);
  return (
    <div className="flex flex-col gap-1">
      <span>
        {item.by === "criterion"
          ? criterion
            ? t("tiebreakers.onCriterion", { criterion: criterion.label })
            : t("tiebreakers.pickCriterion")
          : BY_LABEL[item.by](t)}
      </span>
      {item.by === "raw" && !evened && (
        <p className="text-xs text-muted-fg">{t("tiebreakers.rawUnused")}</p>
      )}
    </div>
  );
}
