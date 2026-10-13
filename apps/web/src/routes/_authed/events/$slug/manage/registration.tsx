import { exportHref } from "#/lib/exports.ts";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  createInviteLinkFn,
  eventInviteLinksQueryOptions,
  onboardingFormQueryOptions,
  saveOnboardingFormFn,
  setInviteLinkDisabledFn,
  deleteInviteLinkFn,
  type InviteLink,
} from "@bogey/db/queries/invites";
import { FIELD_KINDS, type FormField, type FormFieldKind } from "@bogey/db/queries/registration";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { formatDateTime, wallTimeToIso } from "@bogey/utils/time";
import { cleanOptions } from "@bogey/utils/answers";
import { Button } from "@bogey/ui/components/button";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bogey/ui/components/dialog";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import { FieldGroup } from "@bogey/ui/components/field";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { Screen } from "@bogey/ui/components/screen";
import { IconCopy, IconPlus, IconDownload } from "@tabler/icons-react";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { OnboardingFieldPreview } from "#/components/event/team/onboarding-form.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/registration")({
  staticData: {
    title: msg("manageNav.registration"),
    settings: (t) => [
      searchSection(t("manageReg.joining"), { id: "joining" }),
      ...searchSettings("registration", ["capacity", "autoPromote"], t),
      ...searchSettings("identity", ["enabled"], t),
      searchSection(t("window.checkin"), { id: "check-in" }),
      ...searchSettings(
        "checkin",
        ["requiredToCompete", "confirmName", "allowWalkIns", "selfCheckIn", "badgeEmailHours"],
        t,
      ),
      searchSection(t("manageReg.links"), { keywords: ["share", "link"], id: "invite-links" }),
      searchSection(t("manageReg.onboarding"), {
        keywords: ["questions", "registration form", "ask"],
        id: "onboarding",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "registration",
        "identity",
        "checkin",
      ]),
      context.query.ensureQueryData(onboardingFormQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventInviteLinksQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  return (
    <Screen title={t("manageNav.registration")} width="embedded">
      <Screen.Section
        id="joining"
        title={t("manageReg.joining")}
        actions={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "registrations")} download />}
          >
            <IconDownload />
            {t("manageReg.export")}
          </Button>
        }
      >
        <SettingFields scope={scope} namespace="registration" keys={["capacity", "autoPromote"]} />
        <SettingFields scope={scope} namespace="identity" keys={["enabled"]} />
      </Screen.Section>
      <Screen.Section
        id="check-in"
        title={t("window.checkin")}
        description={t("manageReg.checkInHelp")}
      >
        <SettingFields
          scope={scope}
          namespace="checkin"
          keys={[
            "requiredToCompete",
            "confirmName",
            "allowWalkIns",
            "selfCheckIn",
            "badgeEmailHours",
          ]}
        />
      </Screen.Section>
      <InviteLinks />
      <OnboardingEditor />
      <PluginSettingSections page="registration" />
    </Screen>
  );
}

const linkSchema = (t: T) =>
  z.object({
    label: z
      .string()
      .trim()
      .min(1, t("manageReg.nameLink"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("manageReg.linkLabel"), placeholder: t("manageReg.linkPlaceholder") }),
    autoApprove: z.boolean().meta({ label: t("manageReg.autoApprove") }),
    capacity: z
      .union([
        z
          .number()
          .int(t("eventForm.whole"))
          .min(1, t("eventForm.atLeast", { min: 1 })),
        z.nan(),
      ])
      .meta({ label: t("manageReg.limit"), placeholder: t("manageReg.noLimit") }),
    closesAt: z
      .string()
      .meta({ label: t("manageReg.stops") })
      .describe(t("manageReg.stopsHelp")),
  });

const linkOptions = (t: T) =>
  appFormOptions.strictSchema({
    defaultValues: { label: "", autoApprove: false, capacity: Number.NaN, closesAt: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(linkSchema(t))],
  });

function linkState(link: InviteLink, t: T): { open: boolean; reason: string } {
  if (link.disabled_at) return { open: false, reason: t("manageReg.turnedOff") };
  if (link.closes_at && new Date(link.closes_at) <= new Date())
    return { open: false, reason: t("manageReg.expired") };
  if (link.capacity !== null && link.used >= link.capacity) {
    return { open: false, reason: t("agenda.full") };
  }
  return { open: true, reason: t("manageReg.open") };
}

const newInviteLink = createDialogHandle<undefined>();

function InviteLinks() {
  const t = useT();
  const base = useMemo(() => linkOptions(t), [t]);
  const time = useTimeFormat();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: links } = useSuspenseQuery(eventInviteLinksQueryOptions(event.id));
  const [copied, setCopied] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: eventInviteLinksQueryOptions(event.id).queryKey });

  const toggle = useMutation({
    mutationFn: async (change: { id: string; disabled: boolean }) =>
      unwrap(await setInviteLinkDisabledFn({ data: change })),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await deleteInviteLinkFn({ data: id })),
    onSettled: refresh,
  });

  const form = useAppForm({
    ...base,
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await createInviteLinkFn({
        data: {
          eventId: event.id,
          label: value.label,
          autoApprove: value.autoApprove,
          capacity: Number.isNaN(value.capacity) ? null : value.capacity,
          closesAt: wallTimeToIso(value.closesAt, event.timezone),
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      newInviteLink.close();
      await refresh();
      return undefined;
    },
  });

  const copy = (token: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/join/${token}`).then(() => {
      setCopied(token);
      setTimeout(() => setCopied((current) => (current === token ? null : current)), 2000);
    });
  };

  return (
    <Screen.Section
      id="invite-links"
      title={t("manageReg.links")}
      description={t("manageReg.linksHelp")}
      actions={
        <DialogTrigger handle={newInviteLink} render={<Button size="sm" variant="outline" />}>
          <IconPlus />
          {t("manageReg.newLink")}
        </DialogTrigger>
      }
    >
      <Dialog handle={newInviteLink}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("manageReg.newLinkTitle")}</DialogTitle>
            <DialogDescription>
              {t("manageReg.newLinkHelp", { event: event.name })}
            </DialogDescription>
          </DialogHeader>
          <form.AppForm>
            <form.Form unsaved="draft">
              <FieldGroup>
                <form.Field name="label">{(field) => <field.TextField required />}</form.Field>
                <form.Field name="autoApprove">
                  {(field) => (
                    <field.SwitchField
                      description={
                        field.value === true
                          ? t("manageReg.autoOn", { event: event.name })
                          : t("manageReg.autoOff")
                      }
                    />
                  )}
                </form.Field>
                <form.Field name="capacity">{(field) => <field.NumberField min={1} />}</form.Field>
                <form.Field name="closesAt">{(field) => <field.DateTimeField />}</form.Field>
                <form.FormAlert title={t("manageReg.createFailed")} />
                <form.Submit pending={t("teamForm.creating")}>
                  {t("manageReg.createLink")}
                </form.Submit>
              </FieldGroup>
            </form.Form>
          </form.AppForm>
        </DialogContent>
      </Dialog>

      <ErrorAlert error={toggle.error ?? remove.error} title={t("manageReg.changeFailed")} />

      {links.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageReg.noLinks")}</p>
      ) : (
        <DisclosureList>
          {links.map((link) => {
            const state = linkState(link, t);
            return (
              <DisclosureRow
                key={link.id}
                leading={<StatusDot tone={state.open ? "done" : "idle"} label={state.reason} />}
                title={
                  (link.label || t("manageReg.link")) +
                  (link.auto_approve
                    ? ` (${t("manageReg.auto")})`
                    : ` (${t("manageReg.reviewed")})`)
                }
                meta={[
                  `${state.reason}${
                    link.closes_at
                      ? ` ${t("manageReg.until", { when: formatDateTime(link.closes_at, time) })}`
                      : ""
                  }`,
                  link.capacity !== null
                    ? t("manageReg.usedOf", { used: link.used, capacity: link.capacity })
                    : t("manageReg.used", { used: link.used }),
                ]
                  .filter(Boolean)
                  .join(", ")}
                actions={
                  state.open && (
                    <Button size="sm" variant="ghost" onClick={() => copy(link.token)}>
                      <IconCopy />
                      {copied === link.token ? t("common.copied") : t("manageReg.copyLink")}
                    </Button>
                  )
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pl-5">
                  <code className="rounded-md bg-muted px-2 py-1 text-xs break-all select-all">
                    /join/{link.token}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    {link.disabled_at ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: link.id, disabled: false })}
                      >
                        {t("manageReg.turnBackOn")}
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={toggle.isPending}
                        confirm={{
                          title: t("manageReg.turnOffTitle", {
                            name: link.label || t("manageReg.thisLink"),
                          }),
                          description: (
                            <>
                              {t("manageReg.turnOffBefore")}{" "}
                              <Link
                                to="/events/$slug/manage/people"
                                params={{ slug: event.slug }}
                                search={{ link: link.id }}
                              >
                                {t("manageReg.turnOffPeople")}
                              </Link>
                              . {t("manageReg.turnOffAfter")}
                            </>
                          ),
                          label: t("calendar.offLabel"),
                        }}
                        onClick={() => toggle.mutate({ id: link.id, disabled: true })}
                      >
                        {t("calendar.offButton")}
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={remove.isPending}
                      confirm={{
                        title: t("manageReg.removeTitle", {
                          name: link.label || t("manageReg.thisLink"),
                        }),
                        description: t("manageReg.removeBody"),
                        label: t("twoFactor.remove"),
                      }}
                      onClick={() => remove.mutate(link.id)}
                    >
                      {t("twoFactor.removeButton")}
                    </Button>
                  </div>
                </div>
              </DisclosureRow>
            );
          })}
        </DisclosureList>
      )}
    </Screen.Section>
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
    ...appFormOptions.strictSchema({
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
                      footer={
                        question.key && (
                          <>
                            {t("manageReg.savedAs")} <code>{question.key}</code>
                          </>
                        )
                      }
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
