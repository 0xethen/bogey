import { useMemo, useState } from "react";
import { z } from "zod";
import { PASSWORD_MIN, setAdminPasswordFn } from "@bogey/db/auth";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

const schema = (t: T) =>
  z
    .object({
      password: z
        .string()
        .min(PASSWORD_MIN, t("password.min", { min: PASSWORD_MIN }))
        .max(200, t("form.maxLength", { max: 200 }))
        .meta({ label: t("password.new") })
        .describe(t("password.newHelp", { min: PASSWORD_MIN })),
      confirm: z.string().meta({ label: t("password.confirm") }),
    })
    .superRefine((value, ctx) => {
      if (value.confirm !== value.password) {
        ctx.addIssue({ code: "custom", path: ["confirm"], message: t("password.mismatch") });
      }
    });

export function AdminPasswordSection() {
  const t = useT();
  const passwordSchema = useMemo(() => schema(t), [t]);
  const [saved, setSaved] = useState(false);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { password: "", confirm: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(passwordSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      setSaved(false);
      const result = await setAdminPasswordFn({ data: { password: value.password } }).catch(() => ({
        ok: false as const,
        message: t("auth.failure.unreachable"),
      }));
      if (!result.ok) return createValidationError(result.message);
      formApi.reset();
      setSaved(true);
      return undefined;
    },
  });

  return (
    <Screen.Section id="password" title={t("security.password")} description={t("password.intro")}>
      <form.AppForm>
        <form.Form unsaved="draft" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="password">
              {(field) => <field.TextField type="password" autoComplete="new-password" />}
            </form.Field>
            <form.Field name="confirm">
              {(field) => <field.TextField type="password" autoComplete="new-password" />}
            </form.Field>
          </div>
          <form.FormAlert title={t("password.failed")} />
          {saved && (
            <p role="status" className="text-sm text-muted-fg">
              {t("password.saved")}
            </p>
          )}
          <div>
            <form.Submit pending={`${t("common.saving")}...`}>{t("password.set")}</form.Submit>
          </div>
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}
