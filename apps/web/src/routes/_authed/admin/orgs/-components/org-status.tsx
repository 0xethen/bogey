import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { setOrgStatusFn, type InstanceOrg, type OrgStatus } from "@bogey/db/queries/instance";
import { requestFailure } from "@bogey/db/errors";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { FieldGroup } from "@bogey/ui/components/field";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

export const orgStatusDialog = createDialogHandle<InstanceOrg>();

const statusOptions = (t: T): Tuple<{ value: OrgStatus; label: string; description: string }> => [
  { value: "active", label: t("orgStatus.active"), description: t("orgStatus.activeHelp") },
  {
    value: "restricted",
    label: t("adminOrgs.restricted"),
    description: t("orgStatus.restrictedHelp"),
  },
  {
    value: "suspended",
    label: t("suspended.title"),
    description: t("orgStatus.suspendedHelp"),
  },
];

const statusSchema = (t: T) =>
  z.object({
    status: z.enum(["active", "restricted", "suspended"]).meta({ label: t("adminOrgs.status") }),
    reason: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("orgStatus.reason") })
      .describe(t("orgStatus.reasonHelp")),
  });

function StatusForm({ org }: { org: InstanceOrg }) {
  const t = useT();
  const schema = useMemo(() => statusSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { status: org.status, reason: org.statusReason ?? "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await setOrgStatusFn({
        data: { orgId: org.id, status: value.status, reason: value.reason },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      orgStatusDialog.close();
      await queryClient.invalidateQueries({ queryKey: ["instance"] });
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field name="status">
            {(field) => (
              <field.Field>
                <field.Label className="sr-only" />
                <FieldSelect field={field} options={statusOptions(t)} />
              </field.Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.status !== "active"}>
            {(restricted) =>
              restricted && (
                <form.Field name="reason">{(field) => <field.TextAreaField rows={3} />}</form.Field>
              )
            }
          </form.Subscribe>
          <form.FormAlert title={t("orgStatus.failed")} />
          <form.Submit pending={`${t("common.saving")}...`}>{t("orgStatus.save")}</form.Submit>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  );
}

export function OrgStatusDialog() {
  const t = useT();
  return (
    <Dialog handle={orgStatusDialog}>
      {({ payload }) => (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("orgStatus.title", { org: payload?.name ?? t("orgStatus.organization") })}
            </DialogTitle>
            <DialogDescription>{t("orgStatus.intro")}</DialogDescription>
          </DialogHeader>
          {payload && <StatusForm key={payload.id} org={payload} />}
        </DialogContent>
      )}
    </Dialog>
  );
}
