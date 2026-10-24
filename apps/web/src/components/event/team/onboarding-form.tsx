import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { Json } from "@bogey/db/types";
import type { DbResult } from "@bogey/db/errors";
import { requestFailure } from "@bogey/db/errors";
import { browserClient } from "@bogey/db/browser";
import type { Answers, FormField } from "@bogey/db/queries/registration";
import {
  checkAnswers,
  shownFields,
  type FileAnswer,
  type FormFieldKind,
} from "@bogey/utils/registration-form";
import { Input } from "@bogey/ui/components/input";
import { Textarea } from "@bogey/ui/components/textarea";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@bogey/ui/components/field";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { Markdown } from "@bogey/ui/components/markdown";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { useViewerSession } from "#/lib/viewer.ts";
import { useUploadMb } from "#/lib/uploads.ts";
import { useHelperSay, useT } from "#/lib/translate.tsx";
import type { Say } from "@bogey/utils/messages";

type Value = string | boolean | string[] | FileAnswer;
type Values = { [key: string]: Value };

const MAX_FILE_MB = 10;

function emptyValue(kind: FormFieldKind): Value {
  if (kind === "boolean" || kind === "consent") return false;
  if (kind === "multiselect") return [];
  return "";
}

function isFile(value: unknown): value is FileAnswer {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "path" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  );
}

function initial(field: FormField, before: unknown): Value {
  switch (field.kind) {
    case "boolean":
      return before === true;
    case "consent":
      return !!before && typeof before === "object" && "accepted" in before;
    case "multiselect":
      return Array.isArray(before)
        ? before.filter((entry): entry is string => typeof entry === "string")
        : [];
    case "number":
      return typeof before === "number" ? String(before) : "";
    case "file":
      return isFile(before) ? before : "";
    default:
      return typeof before === "string" ? before : "";
  }
}

function toAnswers(fields: Tuple<FormField>, values: Values): Answers {
  const answers: Answers = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.kind === "number") {
      if (typeof value === "string" && value.trim() !== "") answers[field.key] = Number(value);
    } else if (field.kind === "consent") {
      if (value === true) answers[field.key] = { accepted: true };
    } else if (typeof value === "string") {
      answers[field.key] = value.trim();
    } else {
      answers[field.key] = value;
    }
  }
  return answers;
}

const valueSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.object({ path: z.string(), name: z.string(), size: z.number(), type: z.string() }),
]);

function schemaFor(fields: Tuple<FormField>, on: Date, say: Say) {
  const shape = Object.fromEntries(
    fields.map((field) => {
      const labelled = valueSchema.meta({ label: field.label });
      return [field.key, field.help ? labelled.describe(field.help) : labelled];
    }),
  );
  return z.object(shape).superRefine((values, context) => {
    const { problems } = checkAnswers(fields, toAnswers(fields, values), on, say);
    for (const [key, message] of Object.entries(problems)) {
      context.addIssue({ code: "custom", path: [key], message });
    }
  });
}

function dayOf(startsOn: string | null | undefined): Date {
  const parsed = startsOn ? new Date(`${startsOn}T00:00:00Z`) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function OnboardingForm({
  eventId,
  startsOn,
  questions,
  previous,
  submitLabel,
  onSubmit,
  onDone,
  readOnly,
}: {
  eventId: string;
  startsOn?: string | null;
  questions: Tuple<FormField>;
  previous?: Json;
  submitLabel?: string;
  onSubmit?: (answers: Answers) => Promise<DbResult<unknown>>;
  onDone?: () => Promise<void> | void;
  readOnly?: boolean;
}) {
  const t = useT();
  const say = useHelperSay();
  const submit = submitLabel ?? t("onboarding.register");
  const on = dayOf(startsOn);
  const defaults: Values = Object.fromEntries(
    questions.map((field) => {
      const before =
        previous && typeof previous === "object" && !Array.isArray(previous)
          ? previous[field.key]
          : undefined;
      return [field.key, initial(field, before)];
    }),
  );

  const form = useAppForm({
    defaultValues: defaults,
    errorVisibility,
    validators: [rewardEarlyPunishLate(schemaFor(questions, on, say))],
    onSubmit: async ({ value, createValidationError }) => {
      if (!onSubmit) return undefined;
      const { answers } = checkAnswers(questions, toAnswers(questions, value), on);
      const result = await onSubmit(answers).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      await onDone?.();
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          {questions.length === 0 && (
            <p className="text-sm text-muted-fg">
              {t("onboarding.welcome", { action: submit.toLowerCase() })}
            </p>
          )}
          <form.Subscribe selector={(state) => state.values}>
            {(values) =>
              shownFields(questions, toAnswers(questions, values), on).map((question) => (
                <form.Field key={question.key} name={question.key}>
                  {(field) => {
                    const control = (
                      <QuestionControl
                        question={question}
                        id={field.name}
                        eventId={eventId}
                        value={field.value}
                        invalid={field.meta.isInvalid}
                        onChange={(value) => field.handleChange(value)}
                        onBlur={field.handleBlur}
                      />
                    );
                    return question.kind === "boolean" ? (
                      <field.Field orientation="horizontal">
                        {control}
                        <div className="flex flex-col gap-1">
                          <field.Label required={question.required} />
                          <field.Description />
                          <field.Error />
                        </div>
                      </field.Field>
                    ) : (
                      <field.Field>
                        <field.Label required={question.required} />
                        {control}
                        <field.Description />
                        <field.Error />
                      </field.Field>
                    );
                  }}
                </form.Field>
              ))
            }
          </form.Subscribe>
          {!readOnly && (
            <>
              <form.FormAlert title={t("onboarding.failed")} />
              <div>
                <form.Submit pending={`${t("onboarding.sending")}...`}>{submit}</form.Submit>
              </div>
            </>
          )}
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  );
}

function FileQuestion({
  id,
  eventId,
  value,
  invalid,
  onChange,
}: {
  id: string;
  eventId: string;
  value: Value;
  invalid?: boolean;
  onChange: (value: Value) => void;
}) {
  const t = useT();
  const session = useViewerSession();
  const maxMb = useUploadMb(eventId, MAX_FILE_MB);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File): Promise<FileAnswer> => {
      if (!session) throw new Error(t("onboarding.signInToUpload"));
      if (file.size > maxMb * 1024 * 1024) {
        throw new Error(t("onboarding.tooBig", { name: file.name, max: maxMb }));
      }
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
      const path = `${eventId}/${session.user.id}/${crypto.randomUUID()}-${safe}`;
      const { error } = await browserClient().storage.from("registrations").upload(path, file);
      if (error)
        throw new Error(t("onboarding.uploadFailed", { name: file.name, error: error.message }));
      return {
        path,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      };
    },
    onMutate: () => setProblem(null),
    onSuccess: (answer) => onChange(answer),
    onError: (error) => setProblem(error.message),
  });
  const current = isFile(value) ? value : null;
  return (
    <>
      <FileDrop
        id={id}
        files={current ? [{ id: current.path, name: current.name, sizeBytes: current.size }] : []}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
        maxMb={maxMb}
        busy={upload.isPending}
        invalid={invalid || !!problem}
        onAdd={(files) => {
          const [file] = files;
          if (file) upload.mutate(file);
        }}
        onRemove={() => onChange("")}
      />
      {problem && <p className="text-sm text-danger">{problem}</p>}
    </>
  );
}

function QuestionControl({
  question,
  id,
  eventId,
  value,
  invalid,
  onChange,
  onBlur,
}: {
  question: FormField;
  id: string;
  eventId: string;
  value: Value;
  invalid?: boolean;
  onChange: (value: Value) => void;
  onBlur?: () => void;
}) {
  const t = useT();
  if (question.kind === "boolean") {
    return (
      <Checkbox
        id={id}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked === true)}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
      />
    );
  }
  if (question.kind === "consent") {
    return (
      <div className="flex flex-col gap-3">
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border p-3 text-sm">
          <Markdown>{question.text ?? ""}</Markdown>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            onBlur={onBlur}
            aria-invalid={invalid || undefined}
          />
          {t("onboarding.agree")}
        </label>
      </div>
    );
  }
  if (question.kind === "multiselect") {
    return (
      <CheckboxGroup
        value={Array.isArray(value) ? value : []}
        onValueChange={(next) => onChange(next)}
      >
        {(question.options ?? []).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <Checkbox value={option} />
            {option}
          </label>
        ))}
      </CheckboxGroup>
    );
  }
  if (question.kind === "file") {
    return (
      <FileQuestion id={id} eventId={eventId} value={value} invalid={invalid} onChange={onChange} />
    );
  }
  const text = typeof value === "string" ? value : "";
  if (question.kind === "select") {
    return (
      <OptSelect
        id={id}
        value={text}
        placeholder={t("onboarding.chooseOne")}
        options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
        onChange={(next) => {
          onChange(next);
          onBlur?.();
        }}
      />
    );
  }
  const common = {
    id,
    name: id,
    value: text,
    onBlur,
    "aria-invalid": invalid || undefined,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  if (question.kind === "longtext") return <Textarea {...common} />;
  if (question.kind === "number") {
    return (
      <Input
        {...common}
        type="number"
        inputMode="decimal"
        step="any"
        {...(question.min !== undefined ? { min: question.min } : {})}
        {...(question.max !== undefined ? { max: question.max } : {})}
      />
    );
  }
  if (question.kind === "date")
    return <Input {...common} type="date" min="1900-01-01" max="2100-12-31" />;
  const type =
    question.kind === "email"
      ? "email"
      : question.kind === "url"
        ? "url"
        : question.kind === "phone"
          ? "tel"
          : "text";
  return (
    <Input {...common} type={type} autoComplete={question.kind === "phone" ? "tel" : undefined} />
  );
}

const noop = () => {};

export function OnboardingFieldPreview({ question }: { question: FormField }) {
  const t = useT();
  const id = `preview-${question.key || question.label}`;
  const control = (
    <QuestionControl
      question={question}
      id={id}
      eventId=""
      value={emptyValue(question.kind)}
      onChange={noop}
    />
  );
  const label = (
    <FieldLabel htmlFor={id} required={question.required}>
      {question.label || <span className="text-muted-fg">{t("onboarding.untitled")}</span>}
    </FieldLabel>
  );
  return question.kind === "boolean" ? (
    <Field orientation="horizontal">
      {control}
      <div className="flex flex-col gap-1">
        {label}
        {question.help && <FieldDescription>{question.help}</FieldDescription>}
      </div>
    </Field>
  ) : (
    <Field>
      {label}
      {control}
      {question.help && <FieldDescription>{question.help}</FieldDescription>}
    </Field>
  );
}
