import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AUDIENCE_ROLES,
  audienceChoicesQueryOptions,
  postAnnouncementFn,
  type AnnouncementSeverity,
} from "@bogey/db/queries/announcements";
import type { SearchSelectOption } from "@bogey/ui/components/search-select";
import { requestFailure } from "@bogey/db/errors";
import { emitSignal } from "@bogey/plugins/signals";
import { isoToWallTime, wallTimeToIso } from "@bogey/utils/time";
import { createDialogHandle, Dialog } from "@bogey/ui/components/dialog";
import {
  CreateDialogActions,
  CreateDialogContent,
  CreateDialogLayout,
  CreateDialogMain,
  CreateDialogSide,
  CreateDialogTitle,
} from "@bogey/ui/components/create-dialog";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { sayOr, useT, type T } from "#/lib/translate.tsx";
import { PendingAttachments, useAttachmentUploads } from "./message-attachments.tsx";

/** Opens the system file picker; resolves with the chosen files (none if dismissed). */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export const severities = (
  t: T,
): Tuple<{ value: AnnouncementSeverity; label: string; description: string }> => [
  { value: "info", label: t("compose.info"), description: t("compose.infoHelp") },
  { value: "warning", label: t("compose.warning"), description: t("compose.warningHelp") },
  { value: "urgent", label: t("compose.urgent"), description: t("compose.urgentHelp") },
];

const whenOptions = (t: T): Tuple<{ value: "now" | "later"; label: string }> => [
  { value: "now", label: t("compose.now") },
  { value: "later", label: t("compose.later") },
];

const announcementSchema = (t: T) =>
  z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t("compose.needTitle"))
        .max(140, t("compose.titleLength", { max: 140 }))
        .meta({ label: t("compose.title"), placeholder: t("compose.title") }),
      body: z
        .string()
        .max(20_000, t("form.maxLength", { max: 20_000 }))
        .meta({ label: t("compose.message"), placeholder: t("compose.messagePlaceholder") }),
      severity: z.enum(["info", "warning", "urgent"]).meta({ label: t("compose.tone") }),
      audience: z
        .array(z.string())
        .meta({ label: t("compose.audience"), placeholder: t("compose.everyone") }),
      when: z.enum(["now", "later"]).meta({ label: t("compose.when") }),
      publishAt: z.string().meta({ label: t("compose.postAt") }),
      anonymous: z
        .boolean()
        .meta({ label: t("compose.anonymous") })
        .describe(t("compose.anonymousHelp")),
      notify: z
        .boolean()
        .meta({ label: t("compose.notify") })
        .describe(t("compose.notifyHelp")),
    })
    .superRefine((value, ctx) => {
      if (value.when === "later" && !value.publishAt) {
        ctx.addIssue({ code: "custom", path: ["publishAt"], message: t("compose.pickWhen") });
      }
    });

const composerOptions = (t: T) =>
  appFormOptions.strictSchema({
    defaultValues: {
      title: "",
      body: "",
      severity: "info",
      audience: [],
      when: "now",
      publishAt: "",
      anonymous: false,
      notify: false,
    },
    errorVisibility,
    validators: [rewardEarlyPunishLate(announcementSchema(t))],
  });

export interface AnnouncementDraft {
  title: string;
  body: string;
}

export const newAnnouncement = createDialogHandle<AnnouncementDraft | undefined>();

export function NewAnnouncementDialog({
  eventId,
  timeZone,
  anonymous,
  manager,
}: {
  eventId: string;
  timeZone: string;
  anonymous: boolean;
  /** Judges post under their own name and can't schedule (they'd not see it until it posts). */
  manager: boolean;
}) {
  const t = useT();
  const base = useMemo(() => composerOptions(t), [t]);
  const queryClient = useQueryClient();
  const [id, setId] = useState(() => crypto.randomUUID());
  const uploads = useAttachmentUploads(eventId, id);
  const form = useAppForm({
    ...base,
    defaultValues: { ...base.defaultValues, anonymous: manager && anonymous },
    onSubmit: async ({ value, formApi, createValidationError }) => {
      if (uploads.uploading) return createValidationError(t("conv.waitUploads"));
      if (uploads.failed) return createValidationError(t("conv.removeFailed"));
      const result = await postAnnouncementFn({
        data: {
          eventId,
          id,
          attachments: uploads.ready,
          title: value.title,
          bodyMd: value.body,
          severity: value.severity,
          audience: value.audience,
          publishAt: value.when === "later" ? wallTimeToIso(value.publishAt, timeZone) : null,
          anonymous: value.anonymous,
          notify: value.notify,
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      if (value.when !== "later") emitSignal("announcement.sent", eventId);
      formApi.reset();
      uploads.clear();
      setId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["announcements", eventId] });
      newAnnouncement.close();
      return undefined;
    },
  });

  return (
    <Dialog handle={newAnnouncement}>
      {({ payload }) => (
        <CreateDialogContent>
          <ApplyDraft
            draft={payload}
            apply={(draft) => {
              form.setFieldValue("title", draft.title);
              form.setFieldValue("body", draft.body);
            }}
          />
          <form.AppForm>
            <form.DraftGuard />
            <CreateDialogLayout render={<form.Form />}>
              <CreateDialogMain>
                <CreateDialogTitle>{t("compose.heading")}</CreateDialogTitle>
                <form.Field name="title">{(field) => <field.HeadlineField required />}</form.Field>
                <form.Field name="body">
                  {(field) => (
                    <field.BodyField
                      onAttach={async () => {
                        uploads.add(await pickFiles());
                        return undefined;
                      }}
                    />
                  )}
                </form.Field>
                <PendingAttachments items={uploads.items} onRemove={uploads.remove} />
                {uploads.problem && <p className="text-xs text-destructive">{uploads.problem}</p>}
                <form.FormAlert title={t("compose.failed")} />
              </CreateDialogMain>
              <CreateDialogSide>
                <form.Field name="audience">
                  {(field) => (
                    <AudienceOptions eventId={eventId}>
                      {(options, empty) => (
                        <field.MultiSelectField
                          options={options}
                          empty={empty}
                          description={
                            field.value.length ? t("compose.organizersSeeAll") : undefined
                          }
                        />
                      )}
                    </AudienceOptions>
                  )}
                </form.Field>
                <form.Field name="severity">
                  {(field) => (
                    <field.Field>
                      <field.Label />
                      <FieldSelect field={field} options={severities(t)} />
                    </field.Field>
                  )}
                </form.Field>
                {manager && (
                  <form.Field name="when">
                    {(field) => (
                      <field.Field>
                        <field.Label />
                        <FieldSelect
                          field={field}
                          options={whenOptions(t)}
                          onValueChange={(when) => {
                            if (when === "later" && !form.getFieldValue("publishAt")) {
                              const next = new Date();
                              next.setHours(next.getHours() + 1, 0, 0, 0);
                              form.setFieldValue(
                                "publishAt",
                                isoToWallTime(next.toISOString(), timeZone),
                              );
                            }
                          }}
                        />
                      </field.Field>
                    )}
                  </form.Field>
                )}
                <form.Subscribe selector={(state) => state.values.when === "later"}>
                  {(later) =>
                    later && (
                      <form.Field name="publishAt">
                        {(field) => (
                          <field.DateTimeField
                            showIcon={false}
                            description={t("compose.inZone", { zone: timeZone.replace(/_/g, " ") })}
                          />
                        )}
                      </form.Field>
                    )
                  }
                </form.Subscribe>
                {manager && (
                  <form.Field name="anonymous">{(field) => <field.SwitchField />}</form.Field>
                )}
                <form.Field name="notify">{(field) => <field.SwitchField />}</form.Field>
                <CreateDialogActions>
                  <form.Subscribe selector={(state) => state.values.when === "later"}>
                    {(later) => (
                      <form.Submit pending={t("compose.posting")}>
                        {later ? t("compose.schedule") : t("compose.post")}
                      </form.Submit>
                    )}
                  </form.Subscribe>
                </CreateDialogActions>
              </CreateDialogSide>
            </CreateDialogLayout>
          </form.AppForm>
        </CreateDialogContent>
      )}
    </Dialog>
  );
}

function ApplyDraft({
  draft,
  apply,
}: {
  draft: AnnouncementDraft | undefined;
  apply: (draft: AnnouncementDraft) => void;
}) {
  const fill = useEffectEvent(apply);
  useEffect(() => {
    if (draft) fill(draft);
  }, [draft]);
  return null;
}

function AudienceOptions({
  eventId,
  children,
}: {
  eventId: string;
  children: (options: SearchSelectOption[], empty: string) => ReactNode;
}) {
  const t = useT();
  const choices = useQuery(audienceChoicesQueryOptions(eventId));
  const options: SearchSelectOption[] = [
    ...AUDIENCE_ROLES.map((item) => ({
      value: `role:${item.role}`,
      label: sayOr(t, `audienceRole.${item.role}`, item.label),
      group: t("compose.roles"),
    })),
    ...(choices.data?.divisions ?? []).map((division) => ({
      value: `division:${division.id}`,
      label: division.name,
      group: t("compose.divisions"),
    })),
    ...(choices.data?.teams ?? []).map((team) => ({
      value: `team:${team.id}`,
      label: team.name,
      group: t("compose.teams"),
    })),
  ];
  return children(options, choices.isPending ? t("common.loading") : t("compose.noMatch"));
}
