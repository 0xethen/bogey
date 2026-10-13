import { useMemo, useState } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  eventPeopleQueryOptions,
  manageSummaryQueryOptions,
  reviewRegistrationsFn,
} from "@bogey/db/queries/manage";
import { requestFailure } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

type Decision = "approved" | "rejected";

const reviewSchema = (t: T) =>
  z.object({
    note: z
      .string()
      .trim()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("bulk.message") })
      .describe(t("bulk.messageHelp")),
  });

export function BulkReview({
  eventId,
  ids,
  onDone,
}: {
  eventId: string;
  ids: Tuple<string>;
  onDone: () => void;
}) {
  const t = useT();
  const schema = useMemo(() => reviewSchema(t), [t]);
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const closeDialog = () => {
    setDecision(null);
    form.reset();
  };
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: eventPeopleQueryOptions(eventId).queryKey }),
      queryClient.invalidateQueries({ queryKey: manageSummaryQueryOptions(eventId).queryKey }),
    ]);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { note: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      if (!decision) return undefined;
      const result = await reviewRegistrationsFn({
        data: { eventId, ids: [...ids], decision, note: value.note },
      }).catch(requestFailure);
      await refresh();
      if (!result.ok) return createValidationError(result.error.message);
      closeDialog();
      onDone();
      return undefined;
    },
  });

  const verb = decision === "approved" ? t("managePeople.approve") : t("deletions.decline");
  return (
    <>
      <Button size="sm" disabled={ids.length === 0} onClick={() => setDecision("approved")}>
        {t("bulk.approveSelected")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={ids.length === 0}
        onClick={() => setDecision("rejected")}
      >
        {t("bulk.declineSelected")}
      </Button>
      <Dialog open={decision !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bulk.title", { verb, count: ids.length })}</DialogTitle>
            <DialogDescription>{t("bulk.intro")}</DialogDescription>
          </DialogHeader>
          <form.AppForm>
            <form.Form className="flex flex-col gap-4">
              <form.Field name="note">
                {(field) => (
                  <field.TextAreaField
                    rows={3}
                    placeholder={
                      decision === "approved"
                        ? t("bulk.approvePlaceholder")
                        : t("bulk.declinePlaceholder")
                    }
                  />
                )}
              </form.Field>
              <form.FormAlert title={t("bulk.failed")} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t("common.cancel")}
                </Button>
                <form.Submit
                  variant={decision === "rejected" ? "destructive" : "default"}
                  pending={t("bulk.working")}
                >
                  {t("bulk.action", { verb, count: ids.length })}
                </form.Submit>
              </DialogFooter>
            </form.Form>
          </form.AppForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
