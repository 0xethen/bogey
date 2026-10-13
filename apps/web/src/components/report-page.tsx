import { useMemo } from "react";
import { useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { IconFlag } from "@tabler/icons-react";
import { z } from "zod";
import { reportPageFn } from "@bogey/db/queries/instance";
import { requestFailure } from "@bogey/db/errors";
import { orgQueryOptions } from "@bogey/db/tenant";
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
import { FieldGroup } from "@bogey/ui/components/field";
import { toast } from "@bogey/ui/components/toast";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

const reportPage = createDialogHandle<undefined>();

const reportSchema = (t: T) =>
  z.object({
    reason: z
      .string()
      .trim()
      .min(1, t("report.needReason"))
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("report.reason") }),
  });

function ReportForm({ orgId, path }: { orgId: string; path: string }) {
  const t = useT();
  const schema = useMemo(() => reportSchema(t), [t]);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { reason: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await reportPageFn({
        data: { orgId, path, reason: value.reason },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      reportPage.close();
      toast.add({ title: t("report.thanks"), description: t("report.thanksBody") });
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field name="reason">
            {(field) => <field.TextAreaField rows={4} required />}
          </form.Field>
          <form.FormAlert title={t("report.failed")} />
          <form.Submit pending={t("onboarding.sending")}>{t("report.send")}</form.Submit>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  );
}

export function ReportPage() {
  const t = useT();
  const { data: org } = useQuery(orgQueryOptions());
  const path = useLocation({ select: (location) => location.pathname });
  if (!org) return null;
  return (
    <Dialog handle={reportPage}>
      <DialogTrigger render={<Button size="icon-sm" variant="destructive" />}>
        <IconFlag />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("report.title")}</DialogTitle>
          <DialogDescription>{t("report.intro")}</DialogDescription>
        </DialogHeader>
        <ReportForm orgId={org.id} path={path} />
      </DialogContent>
    </Dialog>
  );
}
