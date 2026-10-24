import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { IconFlag } from "@tabler/icons-react";
import { declareConflictFn } from "@bogey/db/queries/conflicts";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { useT } from "#/lib/translate.tsx";
import { FlagDialog } from "./deliberation.tsx";

type Step = "choose" | "deliberate" | "conflict" | null;

/** "Flag..." asks whether to flag the project for deliberation or declare a conflict. */
export function FlagMenu({
  submissionId,
  canDeliberate,
  onConflict,
}: {
  submissionId: string;
  canDeliberate: boolean;
  onConflict: () => unknown;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>(null);
  const declare = useMutation({
    mutationFn: async () => unwrap(await declareConflictFn({ data: { submissionId, reason: "" } })),
    onSuccess: async () => {
      setStep(null);
      await onConflict();
    },
  });
  const close = (open: boolean) => {
    if (!open) setStep(null);
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>
        <IconFlag />
        {t("deliberation.flag")}...
      </Button>
      <Dialog open={step === "choose"} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deliberation.chooseTitle")}</DialogTitle>
            <DialogDescription>{t("deliberation.chooseIntro")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Choice
              title={t("deliberation.flagTitle")}
              help={
                canDeliberate
                  ? t("deliberation.chooseDeliberateHelp")
                  : t("deliberation.chooseDeliberateUnavailable")
              }
              disabled={!canDeliberate}
              onClick={() => setStep("deliberate")}
            />
            <Choice
              title={t("judging.conflictTitle")}
              help={t("deliberation.chooseConflictHelp")}
              onClick={() => setStep("conflict")}
            />
          </div>
        </DialogContent>
      </Dialog>
      <FlagDialog submissionId={submissionId} open={step === "deliberate"} onOpenChange={close} />
      <Dialog open={step === "conflict"} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("judging.conflictTitle")}</DialogTitle>
            <DialogDescription>{t("judging.conflictBody")}</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={declare.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("choose")}>
              {t("common.back")}
            </Button>
            <Button
              variant="destructive"
              disabled={declare.isPending}
              onClick={() => declare.mutate()}
            >
              {declare.isPending ? `${t("common.saving")}...` : t("judging.conflictLabel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Choice({
  title,
  help,
  disabled,
  onClick,
}: {
  title: string;
  help: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col gap-1 rounded-2xl border border-border p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="font-medium">{title}</span>
      <span className="text-sm text-muted-fg">{help}</span>
    </button>
  );
}
