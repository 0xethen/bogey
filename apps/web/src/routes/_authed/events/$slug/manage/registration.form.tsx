import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { onboardingFormQueryOptions, saveOnboardingFormFn } from "@bogey/db/queries/invites";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { tagsQueryOptions } from "@bogey/db/queries/tags";
import { FIELD_KINDS, type FormField, type FormFieldKind } from "@bogey/db/queries/registration";
import { requestFailure } from "@bogey/db/errors";
import { cleanOptions } from "@bogey/utils/answers";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import { Screen } from "@bogey/ui/components/screen";
import { IconPlus } from "@tabler/icons-react";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { OnboardingFieldPreview } from "#/components/event/team/onboarding-form.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { audienceLabel, audienceOf, audienceOptions, audienceValues } from "#/lib/audience.ts";
import { itemFooter } from "#/components/event/item-footer.tsx";
import { msg, useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/registration/form")({
  staticData: {
    title: msg("manageNav.registrationForm"),
    settings: (t) => [
      searchSection(t("manageReg.onboarding"), {
        keywords: ["questions", "registration form", "ask", "onboarding"],
        id: "onboarding",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({ ...onboardingFormQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventDivisionsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...tagsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen
      title={t("manageNav.registrationForm")}
      description={t("manageRegForm.intro")}
      width="embedded"
    >
      <OnboardingEditor />
      <PluginSettingSections page="registration-form" />
    </Screen>
  );
}

const KINDS: Tuple<{ value: FormFieldKind; label: PlainKey }> = [
  { value: "text", label: "fieldKind.text" },
  { value: "longtext", label: "fieldKind.longtext" },
  { value: "select", label: "fieldKind.select" },
  { value: "multiselect", label: "fieldKind.multiselect" },
  { value: "boolean", label: "fieldKind.boolean" },
  { value: "email", label: "fieldKind.email" },
  { value: "url", label: "fieldKind.url" },
  { value: "phone", label: "fieldKind.phone" },
  { value: "date", label: "fieldKind.date" },
  { value: "number", label: "fieldKind.number" },
  { value: "consent", label: "fieldKind.consent" },
  { value: "file", label: "fieldKind.file" },
];

const ALWAYS = "always";

const questionSchema = (t: T) =>
  z.object({
    uid: z.string(),
    key: z.string(),
    label: z
      .string()
      .trim()
      .min(1, t("manageReg.writeQuestion"))
      .max(200, t("form.maxLength", { max: 200 }))
      .meta({ label: t("homeEditor.question"), placeholder: t("manageReg.questionPlaceholder") }),
    kind: z.enum(FIELD_KINDS).meta({ label: t("manageReg.type") }),
    required: z.boolean().meta({ label: t("agenda.required") }),
    options: z
      .array(z.string().max(100, t("manageReg.optionLength", { max: 100 })))
      .meta({ label: t("manageReg.options") }),
    help: z
      .string()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("manageReg.hint"), placeholder: t("manageReg.hintPlaceholder") }),
    text: z
      .string()
      .max(5000, t("form.maxLength", { max: 5000 }))
      .meta({ label: t("manageReg.agreeText") })
      .describe(t("manageReg.agreeTextHelp")),
    min: z.string().meta({ label: t("manageReg.smallest"), placeholder: t("manageReg.noLimit") }),
    max: z.string().meta({ label: t("manageReg.largest"), placeholder: t("manageReg.noLimit") }),
    when: z
      .string()
      .meta({ label: t("manageReg.askThis") })
      .describe(t("manageReg.askThisHelp")),
    whenAge: z
      .string()
      .meta({ label: t("manageReg.youngerThan") })
      .describe(t("manageReg.youngerThanHelp")),
    whenIn: z.array(z.string()).meta({ label: t("manageReg.whenAnswer") }),
    audience: z
      .array(z.string())
      .meta({ label: t("audience.label"), placeholder: t("audience.everyone") })
      .describe(t("audience.questionHelp")),
  });

const wholeNumber = (value: string) => value.trim() === "" || Number.isFinite(Number(value));

const formSchema = (t: T) =>
  z.object({
    questions: z
      .array(questionSchema(t))
      .max(50, t("manageReg.atMost50"))
      .superRefine((questions, ctx) => {
        questions.forEach((question, index) => {
          const issue = (path: string, message: string) =>
            ctx.addIssue({ code: "custom", path: [index, path], message });
          if (
            (question.kind === "select" || question.kind === "multiselect") &&
            !cleanOptions(question.options).length
          ) {
            issue("options", t("manageReg.addOption"));
          }
          if (question.kind === "consent" && !question.text.trim()) {
            issue("text", t("manageReg.writeAgree"));
          }
          if (
            question.kind === "number" &&
            !(wholeNumber(question.min) && wholeNumber(question.max))
          ) {
            issue("min", t("manageReg.useNumbers"));
          }
          if (question.when !== ALWAYS) {
            const target = questions.findIndex((other) => other.uid === question.when);
            const other = questions[target];
            if (!other || target >= index) {
              issue("when", t("manageReg.pickAbove"));
            } else if (other.kind === "date") {
              const years = Number(question.whenAge);
              if (!Number.isInteger(years) || years < 1 || years > 120) {
                issue("whenAge", t("manageReg.wholeYears"));
              }
            } else if (question.whenIn.length === 0) {
              issue("whenIn", t("manageReg.pickAnswers"));
            }
          }
        });
      }),
  });

type Draft = z.infer<ReturnType<typeof questionSchema>>;

function toDraft(field: FormField): Draft {
  const when = field.showWhen;
  return {
    uid: field.key,
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: field.required,
    options: field.options?.length ? field.options : [""],
    help: field.help ?? "",
    text: field.text ?? "",
    min: field.min === undefined ? "" : String(field.min),
    max: field.max === undefined ? "" : String(field.max),
    when: when?.field ?? ALWAYS,
    whenAge: when && "ageUnder" in when ? String(when.ageUnder) : "18",
    whenIn: when && "in" in when ? when.in.map(String) : [],
    audience: audienceValues(field),
  };
}

function toFields(drafts: Tuple<Draft>): FormField[] {
  const used = new Set(drafts.map((draft) => draft.key).filter(Boolean));
  const keys = new Map<string, string>();
  for (const draft of drafts) {
    let key = draft.key;
    if (!key) {
      const base =
        draft.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/^(\d)/, "q_$1")
          .slice(0, 32) || "question";
      key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
    }
    keys.set(draft.uid, key);
  }
  return drafts.map((draft) => {
    const fallback = draft.uid;
    return {
      ...fieldOf(draft, keys.get(draft.uid) ?? fallback),
      ...conditionOf(draft, drafts, keys),
    };
  });
}

function fieldOf(draft: Draft, key: string): FormField {
  const min = draft.min.trim() === "" ? undefined : Number(draft.min);
  const max = draft.max.trim() === "" ? undefined : Number(draft.max);
  return {
    key,
    label: draft.label.trim(),
    kind: draft.kind,
    required: draft.required,
    ...(draft.kind === "select" || draft.kind === "multiselect"
      ? { options: cleanOptions(draft.options) }
      : {}),
    ...(draft.help.trim() ? { help: draft.help.trim() } : {}),
    ...(draft.kind === "consent" && draft.text.trim() ? { text: draft.text.trim() } : {}),
    ...(draft.kind === "number" && min !== undefined ? { min } : {}),
    ...(draft.kind === "number" && max !== undefined ? { max } : {}),
    ...audienceOf(draft.audience),
  };
}

function conditionOf(
  draft: Draft,
  drafts: Tuple<Draft>,
  keys: Map<string, string>,
): Pick<FormField, "showWhen"> {
  if (draft.when === ALWAYS) return {};
  const target = drafts.find((other) => other.uid === draft.when);
  const field = keys.get(draft.when);
  if (!target || !field) return {};
  if (target.kind === "date") return { showWhen: { field, ageUnder: Number(draft.whenAge) } };
  if (target.kind === "boolean") {
    return { showWhen: { field, in: draft.whenIn.map((value) => value === "true") } };
  }
  return { showWhen: { field, in: draft.whenIn } };
}

function previewOf(draft: Draft): FormField {
  return fieldOf(draft, draft.key || draft.uid);
}

function unfinished(draft: Draft): boolean {
  return (
    !draft.label.trim() ||
    ((draft.kind === "select" || draft.kind === "multiselect") &&
      cleanOptions(draft.options).length === 0) ||
    (draft.kind === "consent" && !draft.text.trim())
  );
}

const BLANK: Omit<Draft, "uid"> = {
  key: "",
  label: "",
  kind: "text",
  required: false,
  options: [""],
  help: "",
  text: "",
  min: "",
  max: "",
  when: ALWAYS,
  whenAge: "18",
  whenIn: [],
  audience: [],
};

function conditionChoices(target: Draft, t: T): Tuple<{ value: string; label: string }> {
  if (target.kind === "boolean") {
    return [
      { value: "true", label: t("manageReg.checked") },
      { value: "false", label: t("manageReg.notChecked") },
    ];
  }
  return cleanOptions(target.options).map((option) => ({ value: option, label: option }));
}

function Condition({
  drafts,
  index,
  form,
}: {
  drafts: Tuple<Draft>;
  index: number;
  form: ReturnType<typeof useOnboardingForm>;
}) {
  const t = useT();
  const earlier = drafts
    .slice(0, index)
    .filter(
      (other) =>
        other.kind === "date" ||
        other.kind === "select" ||
        other.kind === "multiselect" ||
        other.kind === "boolean",
    );
  const current = drafts[index];
  if (!current || earlier.length === 0) return null;
  const target = earlier.find((other) => other.uid === current.when);
  const options: Tuple<{ value: string; label: string }> = [
    { value: ALWAYS, label: t("manageReg.always") },
    ...earlier.map((other) => ({
      value: other.uid,
      label: other.label.trim() || t("onboarding.untitled"),
    })),
  ];
  return (
    <>
      <form.Field name={`questions[${index}].when`}>
        {(field) => (
          <field.Field>
            <field.Label />
            <FieldSelect field={field} options={options} />
            <field.Description />
            <field.Error />
          </field.Field>
        )}
      </form.Field>
      {target?.kind === "date" && (
        <form.Field name={`questions[${index}].whenAge`}>
          {(field) => <field.TextField />}
        </form.Field>
      )}
      {target && target.kind !== "date" && (
        <form.Field name={`questions[${index}].whenIn`}>
          {(field) => (
            <field.Field>
              <field.Label />
              <CheckboxGroup value={field.value} onValueChange={(next) => field.handleChange(next)}>
                {conditionChoices(target, t).map((choice) => (
                  <label key={choice.value} className="flex items-center gap-2 text-sm">
                    <Checkbox value={choice.value} />
                    {choice.label}
                  </label>
                ))}
              </CheckboxGroup>
              <field.Error />
            </field.Field>
          )}
        </form.Field>
      )}
    </>
  );
}

function useOnboardingForm(
  fields: Tuple<FormField>,
  onSave: (value: Tuple<Draft>) => Promise<string | null>,
) {
  const t = useT();
  const schema = useMemo(() => formSchema(t), [t]);
  return useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: { questions: fields.map(toDraft) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const problem = await onSave(value.questions);
      if (problem) return createValidationError(problem);
      formApi.reset({ questions: toFields(value.questions).map(toDraft) });
      return undefined;
    },
  });
}

function OnboardingEditor() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: fields } = useSuspenseQuery(onboardingFormQueryOptions(event.id));
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const { data: tags } = useSuspenseQuery(
    tagsQueryOptions({ orgId: event.org_id, eventId: event.id }),
  );
  const audiences = audienceOptions(divisions, tags, t);
  const [active, setActive] = useState<string | null>(null);

  const form = useOnboardingForm(fields, async (questions) => {
    const result = await saveOnboardingFormFn({
      data: { eventId: event.id, fields: toFields(questions) },
    }).catch(requestFailure);
    if (!result.ok) return result.error.message;
    await queryClient.invalidateQueries({
      queryKey: onboardingFormQueryOptions(event.id).queryKey,
    });
    return null;
  });

  return (
    <Screen.Section
      id="onboarding"
      title={t("manageReg.onboarding")}
      description={t("manageReg.onboardingHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save">
          <form.Field name="questions">
            {(list) => (
              <div className="flex flex-col gap-4">
                {list.value.length === 0 && (
                  <p className="text-sm text-muted-fg">{t("manageReg.noQuestions")}</p>
                )}
                <EditableList onMove={(from, to) => list.moveValue(from, to)}>
                  {list.value.map((question, index) => (
                    <EditableListItem
                      key={question.uid}
                      id={question.uid}
                      index={index}
                      noun={t("homeEditor.question")}
                      onRemove={() => list.removeValue(index)}
                      preview={<OnboardingFieldPreview question={previewOf(question)} />}
                      editing={active === question.uid || unfinished(question)}
                      onEdit={() => setActive(question.uid)}
                      onDone={() => setActive(null)}
                      footer={itemFooter(
                        t,
                        question.key,
                        audienceLabel(audienceOf(question.audience), divisions, tags, t),
                      )}
                    >
                      <form.Field name={`questions[${index}].label`}>
                        {(field) => (
                          <field.Field>
                            <field.Label className="sr-only">
                              {t("manageReg.questionN", { n: index + 1 })}
                            </field.Label>
                            <field.TextInput />
                            <field.Error />
                          </field.Field>
                        )}
                      </form.Field>
                      <form.Field name={`questions[${index}].kind`}>
                        {(field) => (
                          <field.Field>
                            <field.Label />
                            <FieldSelect
                              field={field}
                              options={KINDS.map((kind) => ({ ...kind, label: t(kind.label) }))}
                            />
                          </field.Field>
                        )}
                      </form.Field>
                      <form.Field name={`questions[${index}].required`}>
                        {(field) => <field.SwitchField />}
                      </form.Field>
                      {(question.kind === "select" || question.kind === "multiselect") && (
                        <form.Field name={`questions[${index}].options`}>
                          {(field) => <field.OptionsField required />}
                        </form.Field>
                      )}
                      {question.kind === "consent" && (
                        <form.Field name={`questions[${index}].text`}>
                          {(field) => <field.TextAreaField rows={4} />}
                        </form.Field>
                      )}
                      {question.kind === "number" && (
                        <div className="grid grid-cols-2 gap-3">
                          <form.Field name={`questions[${index}].min`}>
                            {(field) => <field.TextField />}
                          </form.Field>
                          <form.Field name={`questions[${index}].max`}>
                            {(field) => <field.TextField />}
                          </form.Field>
                        </div>
                      )}
                      <form.Field name={`questions[${index}].help`}>
                        {(field) => <field.TextField />}
                      </form.Field>
                      <Condition drafts={list.value} index={index} form={form} />
                      {audiences.length > 0 && (
                        <form.Field name={`questions[${index}].audience`}>
                          {(field) => <field.MultiSelectField options={audiences} />}
                        </form.Field>
                      )}
                    </EditableListItem>
                  ))}
                </EditableList>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({ ...BLANK, uid });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("homeEditor.addQuestion")}
                  </Button>
                </div>
                <form.FormAlert title={t("manageReg.saveFailed")} />
              </div>
            )}
          </form.Field>
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}
