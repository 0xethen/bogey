import { useMemo, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  deleteSubmissionFormFn,
  saveSubmissionFormFn,
  submissionFormsQueryOptions,
  type SubmissionForm,
  type SubmissionItem,
} from "@bogey/db/queries/submissions";
import { setWindowsFn } from "@bogey/db/queries/manage";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldDescription, FieldGroup } from "@bogey/ui/components/field";
import { Switch } from "@bogey/ui/components/switch";
import { IconPlus } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { windowLabel } from "#/lib/windows.ts";
import { SubmissionItemPreview } from "#/components/event/submission/submission-item-field.tsx";
import { useEventRefresh } from "#/lib/refresh.ts";
import {
  answerKind,
  cleanOptions,
  isCoreAnswerKind,
  isPluginAnswerKind,
} from "@bogey/utils/answers";
import {
  itemConfigDefaults,
  pluginItemTypes,
  showConditions,
  validItemConfig,
  type MountedItemType,
} from "@bogey/plugins";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";

const eventRoute = getRouteApi("/_authed/events/$slug");

interface KindOption {
  value: string;
  label: string;
  description: string;
}

const KINDS: Tuple<{ value: string; label: PlainKey; description: PlainKey }> = [
  { value: "text", label: "fieldKind.text", description: "itemKind.textHelp" },
  { value: "longtext", label: "fieldKind.longtext", description: "itemKind.longtextHelp" },
  { value: "markdown", label: "itemKind.markdown", description: "itemKind.markdownHelp" },
  { value: "url", label: "fieldKind.url", description: "itemKind.urlHelp" },
  { value: "video", label: "itemKind.video", description: "itemKind.videoHelp" },
  { value: "drive", label: "itemKind.drive", description: "itemKind.driveHelp" },
  { value: "file", label: "fieldKind.file", description: "itemKind.fileHelp" },
  { value: "select", label: "fieldKind.select", description: "itemKind.selectHelp" },
  { value: "boolean", label: "fieldKind.boolean", description: "itemKind.booleanHelp" },
  { value: "number", label: "fieldKind.number", description: "itemKind.numberHelp" },
];

const OWN_WINDOW = "__own";

const itemSchema = (t: T) =>
  z.object({
    uid: z.string(),
    key: z.string(),
    label: z
      .string()
      .trim()
      .min(1, t("manageForms.nameItem"))
      .max(200, t("form.maxLength", { max: 200 }))
      .meta({ label: t("manageForms.item"), placeholder: t("manageForms.itemPlaceholder") }),
    kind: z
      .string()
      .refine((kind): boolean => isCoreAnswerKind(kind) || isPluginAnswerKind(kind), {
        message: t("manageForms.chooseType"),
      })
      .meta({ label: t("manageReg.type") }),
    required: z.boolean().meta({ label: t("agenda.required") }),
    help: z
      .string()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("manageReg.hint"), placeholder: t("manageForms.hintPlaceholder") }),
    options: z
      .array(z.string().max(100, t("manageReg.optionLength", { max: 100 })))
      .meta({ label: t("manageReg.options") }),
    maxLength: z
      .string()
      .regex(/^\d*$/, t("manageForms.wholeOrBlank"))
      .meta({ label: t("manageForms.charLimit"), placeholder: t("manageForms.default") }),
    accept: z
      .string()
      .max(200)
      .meta({ label: t("manageForms.fileTypes"), placeholder: ".pdf,.pptx" }),
    maxMb: z
      .string()
      .regex(/^\d*$/, t("manageForms.wholeOrBlank"))
      .meta({ label: t("manageForms.sizeLimit"), placeholder: "50" }),
    namesPeople: z
      .boolean()
      .meta({ label: t("manageForms.namesPeople") })
      .describe(t("manageForms.namesPeopleHelp")),
    config: z.record(z.string(), z.string()),
  });

const formSchema = (t: T) =>
  z.object({
    title: z
      .string()
      .trim()
      .min(1, t("manageForms.needTitle"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("compose.title"), placeholder: t("manageForms.titlePlaceholder") }),
    description: z
      .string()
      .max(5000, t("form.maxLength", { max: 5000 }))
      .meta({ label: t("manageForms.instructions") })
      .describe(t("manageForms.instructionsHelp")),
    window: z
      .string()
      .min(1, t("manageForms.chooseWindow"))
      .meta({ label: t("manageForms.opensWithLabel") }),
    judged: z
      .boolean()
      .meta({ label: t("manageForms.judged") })
      .describe(t("manageForms.judgedHelp")),
    divisions: z
      .array(z.string())
      .meta({ label: t("manageForms.audience"), placeholder: t("manageForms.everyone") })
      .describe(t("manageForms.audienceHelp")),
    items: z
      .array(itemSchema(t))
      .max(60, t("manageForms.atMost60"))
      .superRefine((items, ctx) => {
        items.forEach((item, index) => {
          if (item.kind === "select" && !cleanOptions(item.options).length) {
            ctx.addIssue({
              code: "custom",
              path: [index, "options"],
              message: t("manageReg.addOption"),
            });
          }
        });
      }),
  });

type ItemDraft = z.infer<ReturnType<typeof itemSchema>>;

function slug(text: string, separator: "_" | "-"): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "")
    .replace(/^(\d)/, "x$1")
    .slice(0, 32);
  return base || (separator === "_" ? "item" : "form");
}

function toDraft(item: SubmissionItem): ItemDraft {
  return {
    uid: item.key,
    key: item.key,
    label: item.label,
    kind: item.kind,
    required: item.required,
    help: item.help ?? "",
    options: item.options.length ? item.options : [""],
    maxLength: item.maxLength ? String(item.maxLength) : "",
    accept: item.accept ?? "",
    maxMb: item.maxMb ? String(item.maxMb) : "",
    namesPeople: item.namesPeople === true,
    config: Object.fromEntries(
      Object.entries(item.config ?? {}).map(([name, value]) => [name, String(value)]),
    ),
  };
}

function configOf(
  draft: ItemDraft,
  types: Tuple<MountedItemType>,
): Record<string, string | number | boolean> | undefined {
  const type = types.find((candidate) => candidate.kind === draft.kind);
  if (!type) return undefined;
  const typed = Object.fromEntries(
    Object.entries(draft.config).map(([name, value]) => {
      const setting = type.config[name];
      if (setting?.type === "number")
        return [name, value.trim() === "" ? undefined : Number(value)];
      if (setting?.type === "boolean") return [name, value === "true"];
      return [name, value];
    }),
  );
  const valid = validItemConfig(type, { ...itemConfigDefaults(type), ...typed });
  return Object.keys(valid).length ? valid : undefined;
}

function toItems(drafts: Tuple<ItemDraft>, types: Tuple<MountedItemType>): SubmissionItem[] {
  const used = new Set(drafts.map((draft) => draft.key).filter(Boolean));
  return drafts.map((draft) => {
    let key = draft.key;
    if (!key) {
      const base = slug(draft.label, "_");
      key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
    }
    return {
      key,
      label: draft.label.trim(),
      help: draft.help.trim() || null,
      kind: answerKind(draft.kind) ?? "text",
      required: draft.required,
      options: draft.kind === "select" ? cleanOptions(draft.options) : [],
      maxLength: draft.maxLength ? Number(draft.maxLength) : undefined,
      accept: draft.kind === "file" && draft.accept.trim() ? draft.accept.trim() : undefined,
      maxMb: draft.kind === "file" && draft.maxMb ? Number(draft.maxMb) : undefined,
      namesPeople: draft.namesPeople || undefined,
      config: configOf(draft, types),
    };
  });
}

function previewOf(draft: ItemDraft, types: Tuple<MountedItemType>): SubmissionItem {
  return {
    key: draft.key || draft.uid,
    label: draft.label.trim(),
    help: draft.help.trim() || null,
    kind: answerKind(draft.kind) ?? "text",
    required: draft.required,
    options: draft.kind === "select" ? cleanOptions(draft.options) : [],
    accept: draft.kind === "file" && draft.accept.trim() ? draft.accept.trim() : undefined,
    maxMb: draft.kind === "file" && draft.maxMb ? Number(draft.maxMb) : undefined,
    namesPeople: draft.namesPeople || undefined,
    config: configOf(draft, types),
  };
}

function visibleConfig(types: Tuple<MountedItemType>, draft: ItemDraft, name: string): boolean {
  const type = types.find((candidate) => candidate.kind === draft.kind);
  const setting = type?.config[name];
  if (!type || !setting) return true;
  return showConditions(setting.showWhen).every((condition) => {
    const other = type.config[condition.setting];
    const raw =
      draft.config[condition.setting] ??
      (other?.default !== undefined ? String(other.default) : "");
    const current =
      other?.type === "boolean" ? raw === "true" : other?.type === "number" ? Number(raw) : raw;
    return (
      visibleConfig(types, draft, condition.setting) &&
      condition.in.some((allowed) => Object.is(allowed, current))
    );
  });
}

function unfinished(draft: ItemDraft): boolean {
  return (
    !draft.label.trim() || (draft.kind === "select" && cleanOptions(draft.options).length === 0)
  );
}

const BLANK: Omit<ItemDraft, "uid"> = {
  key: "",
  label: "",
  kind: "text",
  required: false,
  help: "",
  options: [""],
  maxLength: "",
  accept: "",
  maxMb: "",
  namesPeople: false,
  config: {},
};

const FIRST_ITEM: ItemDraft = { ...BLANK, uid: "first", kind: "markdown" };

/** Edits a form, or creates one when `form` is null; `onDone` runs once it is created, and on Cancel. */
export function FormEditor({ form, onDone }: { form: SubmissionForm | null; onDone?: () => void }) {
  const t = useT();
  const schema = useMemo(() => formSchema(t), [t]);
  const { event, plugins } = eventRoute.useRouteContext();
  const itemTypes = pluginItemTypes(plugins);
  const kinds: Tuple<KindOption> = [
    ...KINDS.map((kind) => ({
      value: kind.value,
      label: t(kind.label),
      description: t(kind.description),
    })),
    ...itemTypes.map((type) => ({
      value: type.kind,
      label: type.label,
      description: t("manageForms.fromPlugin", {
        description: type.description,
        plugin: type.pluginName,
      }),
    })),
    ...(form?.items ?? [])
      .filter(
        (item) => isPluginAnswerKind(item.kind) && !itemTypes.some((t) => t.kind === item.kind),
      )
      .map((item) => ({
        value: item.kind,
        label: item.kind,
        description: t("manageForms.pluginOff"),
      })),
  ];
  const queryClient = useQueryClient();
  const refreshEvent = useEventRefresh(event.id);
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const [active, setActive] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: submissionFormsQueryOptions(event.id).queryKey }),
      refreshEvent(),
      queryClient.invalidateQueries({ queryKey: ["my-submissions", event.id] }),
    ]);

  const windowOptions = [
    ...windows.map((window) => ({ value: window.key, label: windowLabel(window, t) })),
    ...(windows.some((window) => window.key === "submissions")
      ? []
      : [{ value: "submissions", label: windowLabel({ key: "submissions" }, t) }]),
    {
      value: OWN_WINDOW,
      label: t("manageForms.ownWindow"),
      description: t("manageForms.ownWindowHelp"),
    },
  ];

  const editor = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        title: form?.title ?? "",
        description: form?.description_md ?? "",
        window: form?.window_key ?? "submissions",
        judged: form?.judged ?? true,
        divisions: form?.divisionIds ?? [],
        items: form ? form.items.map(toDraft) : [FIRST_ITEM],
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const key = form?.key ?? slug(value.title, "-");
      const windowKey = value.window === OWN_WINDOW ? `submit-${key}`.slice(0, 40) : value.window;
      if (!windows.some((window) => window.key === windowKey)) {
        const created = await setWindowsFn({
          data: {
            eventId: event.id,
            windows: [{ key: windowKey, opens_at: null, closes_at: null, override: null }],
          },
        }).catch(requestFailure);
        if (!created.ok) return createValidationError(created.error.message);
      }
      const items = toItems(value.items, itemTypes);
      const result = await saveSubmissionFormFn({
        data: {
          eventId: event.id,
          form: {
            id: form?.id ?? null,
            key,
            title: value.title,
            descriptionMd: value.description,
            windowKey,
            judged: value.judged,
            divisionIds: value.divisions,
          },
          items,
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset({ ...value, window: windowKey, items: items.map(toDraft) });
      await refresh();
      if (!form) onDone?.();
      return undefined;
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await deleteSubmissionFormFn({ data: id })),
    onSuccess: refresh,
  });

  return (
    <editor.AppForm>
      <editor.Form
        unsaved="save"
        className={form ? "flex flex-col gap-6 pl-1" : "flex flex-col gap-6"}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <editor.Field name="title">{(field) => <field.TextField required />}</editor.Field>
            <editor.Field name="window">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect field={field} options={windowOptions} />
                  <field.Error />
                </field.Field>
              )}
            </editor.Field>
          </div>
          <editor.Field name="description">
            {(field) => <field.MarkdownField rows={3} features="short" />}
          </editor.Field>
          <editor.Field name="judged">{(field) => <field.SwitchField />}</editor.Field>
          {divisions.length > 0 && (
            <editor.Field name="divisions">
              {(field) => (
                <field.MultiSelectField
                  options={divisions.map((division) => ({
                    value: division.id,
                    label: division.name,
                  }))}
                />
              )}
            </editor.Field>
          )}
        </FieldGroup>

        <editor.Field name="items">
          {(list) => (
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-medium">{t("manageForms.itemsHeading")}</h4>
              <p className="text-sm text-muted-fg">{t("manageForms.itemsHelp")}</p>
              <EditableList
                onMove={(from, to) => list.moveValue(from, to)}
                empty={t("manageForms.noItems")}
              >
                {list.value.map((item, index) => (
                  <EditableListItem
                    key={item.uid}
                    id={item.uid}
                    index={index}
                    noun={t("manageForms.itemNoun")}
                    onRemove={() => list.removeValue(index)}
                    preview={<SubmissionItemPreview item={previewOf(item, itemTypes)} />}
                    editing={active === item.uid || unfinished(item)}
                    onEdit={() => setActive(item.uid)}
                    onDone={() => setActive(null)}
                    footer={
                      item.key && (
                        <>
                          {t("manageReg.savedAs")} <code>{item.key}</code>
                        </>
                      )
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                      <editor.Field name={`items[${index}].label`}>
                        {(field) => (
                          <field.Field>
                            <field.Label className="sr-only">
                              {t("manageForms.itemN", { n: index + 1 })}
                            </field.Label>
                            <field.TextInput />
                            <field.Error />
                          </field.Field>
                        )}
                      </editor.Field>
                      <editor.Field name={`items[${index}].kind`}>
                        {(field) => (
                          <field.Field>
                            <field.Label className="sr-only" />
                            <FieldSelect field={field} options={kinds} />
                          </field.Field>
                        )}
                      </editor.Field>
                    </div>
                    {Object.entries(
                      itemTypes.find((type) => type.kind === item.kind)?.config ?? {},
                    ).map(
                      ([name, setting]) =>
                        visibleConfig(itemTypes, item, name) && (
                          <editor.Field key={name} name={`items[${index}].config.${name}`}>
                            {(field) =>
                              setting.type === "boolean" ? (
                                <field.Field>
                                  <field.Label>{setting.label}</field.Label>
                                  <Switch
                                    checked={(field.value ?? "") === "true"}
                                    onCheckedChange={(on) => field.handleChange(String(on))}
                                  />
                                  {setting.description && (
                                    <FieldDescription>{setting.description}</FieldDescription>
                                  )}
                                </field.Field>
                              ) : setting.type === "select" ? (
                                <field.Field>
                                  <field.Label>{setting.label}</field.Label>
                                  <FieldSelect field={field} options={setting.options} />
                                  {setting.description && (
                                    <FieldDescription>{setting.description}</FieldDescription>
                                  )}
                                </field.Field>
                              ) : (
                                <field.TextField
                                  label={setting.label}
                                  description={setting.description}
                                  placeholder={
                                    setting.type === "string"
                                      ? setting.placeholder
                                      : setting.default !== undefined
                                        ? String(setting.default)
                                        : undefined
                                  }
                                />
                              )
                            }
                          </editor.Field>
                        ),
                    )}
                    {item.kind === "select" && (
                      <editor.Field name={`items[${index}].options`}>
                        {(field) => <field.OptionsField required />}
                      </editor.Field>
                    )}
                    {(item.kind === "text" ||
                      item.kind === "longtext" ||
                      item.kind === "markdown") && (
                      <editor.Field name={`items[${index}].maxLength`}>
                        {(field) => <field.TextField />}
                      </editor.Field>
                    )}
                    {item.kind === "file" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <editor.Field name={`items[${index}].accept`}>
                          {(field) => <field.TextField />}
                        </editor.Field>
                        <editor.Field name={`items[${index}].maxMb`}>
                          {(field) => <field.TextField />}
                        </editor.Field>
                      </div>
                    )}
                    <editor.Field name={`items[${index}].help`}>
                      {(field) => <field.TextField />}
                    </editor.Field>
                    <editor.Field name={`items[${index}].required`}>
                      {(field) => <field.SwitchField />}
                    </editor.Field>
                    <editor.Field name={`items[${index}].namesPeople`}>
                      {(field) => <field.SwitchField />}
                    </editor.Field>
                  </EditableListItem>
                ))}
              </EditableList>
              <div>
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
                  {t("manageForms.addItem")}
                </Button>
              </div>
            </div>
          )}
        </editor.Field>

        <editor.FormAlert title={t("manageForms.saveFailed")} />
        <ErrorAlert error={remove.error} title={t("manageForms.deleteFailed")} />
        <div className="flex flex-wrap gap-2">
          {!form && (
            <editor.Submit pending={`${t("teamForm.creating")}...`}>
              {t("manageForms.create")}
            </editor.Submit>
          )}
          {onDone && (
            <Button type="button" variant="ghost" onClick={onDone}>
              {t("common.cancel")}
            </Button>
          )}
          {form && (
            <Button
              variant="ghost-destructive"
              className="ml-auto"
              disabled={remove.isPending}
              confirm={{
                title: t("manageForms.deleteTitle", { name: form.title }),
                description: t("manageForms.deleteBody"),
                label: t("manageForms.deleteLabel"),
              }}
              onClick={() => remove.mutate(form.id)}
            >
              {t("manageForms.deleteButton")}...
            </Button>
          )}
        </div>
      </editor.Form>
    </editor.AppForm>
  );
}
