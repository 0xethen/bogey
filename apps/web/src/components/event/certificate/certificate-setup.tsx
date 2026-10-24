import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCheck } from "@tabler/icons-react";
import type { CertificateDesigns, DesignScope } from "@bogey/db/queries/certificates";
import { updateSettings } from "@bogey/db/queries/settings";
import { unwrap } from "@bogey/db/errors";
import {
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  type CertificateKind,
} from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { toast } from "@bogey/ui/components/toast";
import { sayOr, useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { AssignSlidesDialog } from "./background-import.tsx";
import { designState, givenKinds, unsetKinds } from "./certificate-status.ts";
import { useDesignActions } from "./design-actions.ts";

export function certificateKindName(t: T, kind: CertificateKind): string {
  return sayOr(t, `certKind.${kind}`, CERTIFICATE_LABELS[kind]);
}

const KIND_HELP: Record<CertificateKind, PlainKey> = {
  participation: "certSetup.participationHelp",
  award: "certSetup.awardHelp",
  judge: "certSetup.judgeHelp",
  volunteer: "certSetup.volunteerHelp",
};

/** Turning certificates on (or changing which are given), then setting each one up or leaving it
 * for later; what's left shows as a to-do on the page and the Manage overview. */
export function CertificateSetupDialog({
  open,
  onOpenChange,
  orgId,
  eventId,
  slug,
  enabled,
  kinds,
  designs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  eventId: string;
  slug: string;
  enabled: boolean;
  kinds: Tuple<CertificateKind> | undefined;
  designs: CertificateDesigns;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"kinds" | "designs">("kinds");
  const [picked, setPicked] = useState<CertificateKind[]>(() => givenKinds(kinds));
  const [missing, setMissing] = useState(false);
  const close = () => {
    onOpenChange(false);
    setStep("kinds");
    setMissing(false);
    save.reset();
  };
  const save = useMutation({
    mutationFn: async (next: CertificateKind[]) =>
      unwrap(
        await updateSettings({ scope: "event", eventId }, "certificates", {
          enabled: true,
          // every kind is stored as unset, so kinds added later are given too
          kinds: next.length === CERTIFICATE_KINDS.length ? null : next,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setStep("designs");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setPicked(givenKinds(kinds));
          onOpenChange(true);
        } else close();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("certSetup.title")}</DialogTitle>
          <DialogDescription>
            {step === "kinds" ? t("certSetup.intro") : t("certSetup.designsIntro")}
          </DialogDescription>
        </DialogHeader>
        {step === "kinds" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">{t("certSetup.which")}</legend>
            <CheckboxGroup
              value={picked}
              onValueChange={(next) => {
                setMissing(false);
                setPicked(CERTIFICATE_KINDS.filter((kind) => next.includes(kind)));
              }}
            >
              {CERTIFICATE_KINDS.map((kind) => (
                <label key={kind} className="flex items-start gap-3">
                  <Checkbox value={kind} className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{certificateKindName(t, kind)}</span>
                    <span className="text-muted-fg">{t(KIND_HELP[kind])}</span>
                  </span>
                </label>
              ))}
            </CheckboxGroup>
            {missing && <ErrorAlert error={t("certSetup.pickOne")} />}
            <ErrorAlert error={save.error} />
          </fieldset>
        ) : (
          <SetupList
            scope={{ orgId, eventId }}
            slug={slug}
            kinds={picked}
            designs={designs}
            onLeave={close}
          />
        )}
        <DialogFooter>
          {step === "kinds" ? (
            <>
              <Button variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  if (picked.length === 0) setMissing(true);
                  else save.mutate(picked);
                }}
              >
                {enabled ? t("common.save") : t("certSetup.next")}
              </Button>
            </>
          ) : (
            <Button onClick={close}>
              {unsetKinds(designs, picked).length > 0 ? t("certSetup.later") : t("certSetup.done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Each given certificate with how it looks now and a way to set it up. */
export function SetupList({
  scope,
  slug,
  kinds,
  designs,
  onLeave,
}: {
  scope: DesignScope & { eventId: string };
  slug: string;
  kinds: Tuple<CertificateKind>;
  designs: CertificateDesigns;
  /** Called when a link leaves for a kind's editor. */
  onLeave?: () => void;
}) {
  const t = useT();
  const actions = useDesignActions(scope);
  const [importing, setImporting] = useState(false);
  const keep = useMutation({ mutationFn: actions.keepStandard });
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {kinds.map((kind) => {
          const state = designState(designs, kind);
          return (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 font-medium">
                  {state !== "standard" && <IconCheck className="size-4 text-primary" />}
                  {certificateKindName(t, kind)}
                </span>
                <span className="text-xs text-muted-fg">
                  {state === "own"
                    ? t("certSetup.stepOwn")
                    : state === "org"
                      ? t("certSetup.stepOrg")
                      : t("certSetup.stepHelp")}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {state === "standard" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={keep.isPending}
                    onClick={() => keep.mutate(kind)}
                  >
                    {t("certSetup.keepStandard")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={state === "standard" ? "default" : "outline"}
                  nativeButton={false}
                  render={
                    <Link
                      to="/events/$slug/manage/certificates/$kind"
                      params={{ slug, kind }}
                      onClick={onLeave}
                    />
                  }
                >
                  {state === "standard" ? t("certSetup.setUp") : t("manageCerts.edit")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorAlert error={keep.error} />
      <div>
        <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
          {t("certImport.importSlides")}
        </Button>
      </div>
      <AssignSlidesDialog
        open={importing}
        onOpenChange={setImporting}
        kinds={kinds}
        kindName={(kind) => certificateKindName(t, kind)}
        apply={actions.setBackground}
        onApplied={(count) => toast.add({ title: t("certImport.applied", { count }) })}
      />
    </div>
  );
}
