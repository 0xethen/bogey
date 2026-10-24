import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  assignTablesFn,
  tableListQueryOptions,
  TABLE_GROUPS,
  TABLE_SCHEMES,
} from "@bogey/db/queries/expo";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { requestFailure } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";

const tablesSchema = (t: T) =>
  z
    .object({
      formId: z
        .string()
        .min(1, t("tablesEditor.pickForm"))
        .meta({ label: t("tablesEditor.form") }),
      scheme: z.enum(TABLE_SCHEMES).meta({ label: t("tablesEditor.numbering") }),
      prefix: z
        .string()
        .trim()
        .max(10, t("tablesEditor.prefixLength", { max: 10 }))
        .meta({ label: t("tablesEditor.prefix"), placeholder: "A" }),
      start: z
        .number(t("orgLimit.enterNumber"))
        .int(t("eventForm.whole"))
        .min(0, t("tablesEditor.startMin"))
        .max(9999, t("tablesEditor.startMax"))
        .meta({ label: t("tablesEditor.startAt") }),
      group: z.enum(TABLE_GROUPS).meta({ label: t("tablesEditor.group") }),
      replace: z.boolean().meta({ label: t("tablesEditor.replace") }),
    })
    .superRefine((value, ctx) => {
      if (value.scheme === "prefix" && !value.prefix) {
        ctx.addIssue({ code: "custom", path: ["prefix"], message: t("tablesEditor.needPrefix") });
      }
    });

const SCHEMES = [
  { value: "numeric", label: "1, 2, 3" },
  { value: "prefix", label: "A1, A2, A3" },
] as const;

const GROUPS = [
  { value: "none", label: "tablesEditor.groupNone" },
  { value: "division", label: "tablesEditor.groupDivision" },
  { value: "track", label: "tablesEditor.groupPrize" },
] as const satisfies Tuple<{ value: string; label: PlainKey }>;

export function Tables({ eventId, slug }: { eventId: string; slug: string }) {
  const t = useT();
  const schema = useMemo(() => tablesSchema(t), [t]);
  const queryClient = useQueryClient();
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(eventId));
  const { data: list } = useSuspenseQuery(tableListQueryOptions(eventId));
  const judged = forms.filter((form) => form.judged);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        formId: judged[0]?.id ?? "",
        scheme: "numeric",
        prefix: "",
        start: 1,
        group: "none",
        replace: false,
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await assignTablesFn({ data: value }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      setNotice(t("tablesEditor.numbered", { count: result.data }));
      await queryClient.invalidateQueries({ queryKey: tableListQueryOptions(eventId).queryKey });
      return undefined;
    },
  });
  const numbered = list.filter((row) => row.table).length;

  if (judged.length === 0) return null;
  return (
    <Screen.Section
      id="expo-tables"
      title={t("tablesEditor.title")}
      description={t("tablesEditor.intro")}
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          disabled={numbered === 0}
          render={<Link to="/events/$slug/tables" params={{ slug }} />}
        >
          {t("tablesEditor.print")}...
        </Button>
      }
    >
      <form.AppForm>
        <form.Form className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            {judged.length > 1 && (
              <form.Field name="formId">
                {(field) => (
                  <field.Field className="w-48">
                    <field.Label />
                    <FieldSelect
                      field={field}
                      options={judged.map((item) => ({ value: item.id, label: item.title }))}
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
            )}
            <form.Field name="scheme">
              {(field) => (
                <field.Field className="w-40">
                  <field.Label />
                  <FieldSelect field={field} options={SCHEMES} />
                </field.Field>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.scheme === "prefix"}>
              {(prefixed) =>
                prefixed && (
                  <form.Field name="prefix">
                    {(field) => (
                      <field.Field className="w-24">
                        <field.Label />
                        <field.TextInput maxLength={10} />
                        <field.Error />
                      </field.Field>
                    )}
                  </form.Field>
                )
              }
            </form.Subscribe>
            <form.Field name="start">
              {(field) => (
                <field.Field className="w-32">
                  <field.Label />
                  <field.NumberInput min={0} max={9999} />
                  <field.Error />
                </field.Field>
              )}
            </form.Field>
            <form.Field name="group">
              {(field) => (
                <field.Field className="w-44">
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={GROUPS.map((each) => ({ ...each, label: t(each.label) }))}
                  />
                </field.Field>
              )}
            </form.Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <form.Field name="replace">
              {(field) => (
                <field.Field orientation="horizontal">
                  <field.Switch />
                  <field.Label />
                </field.Field>
              )}
            </form.Field>
            <form.Submit size="sm" pending={`${t("tablesEditor.numbering2")}...`}>
              {t("tablesEditor.number")}
            </form.Submit>
            {notice && (
              <span role="status" className="text-sm text-muted-fg">
                {notice}
              </span>
            )}
          </div>
          <form.FormAlert title={t("tablesEditor.failed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}
