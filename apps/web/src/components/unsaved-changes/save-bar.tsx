import { useEffect, useRef } from "react";
import { cn } from "@bogey/ui/lib/utils";
import { Button } from "@bogey/ui/components/button";
import { useT } from "#/lib/translate.tsx";

export function SaveBar({
  visible,
  saving,
  message,
  attention = 0,
  onSave,
  onReset,
  onDismiss,
}: {
  visible: boolean;
  saving?: boolean;
  message?: string;
  attention?: number;
  onSave?: () => void;
  onReset: () => void;
  onDismiss?: () => void;
}) {
  const t = useT();
  const main = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (attention > 0) main.current?.focus({ preventScroll: true });
  }, [attention]);

  if (!visible) return null;
  return (
    <>
      <div aria-hidden className="h-20" />
      <div
        role="region"
        aria-label={t("unsaved.label")}
        className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl animate-in duration-200 fade-in-0 slide-in-from-bottom-4"
      >
        <div
          key={attention}
          className={cn(
            "flex items-center gap-2 rounded-2xl bg-popover py-2.5 pr-2.5 pl-4 text-popover-fg shadow-xl ring-1 ring-fg/10",
            attention > 0 && "animate-nudge ring-2 ring-primary/20",
          )}
        >
          <p className="flex-1 text-sm font-medium" aria-live="polite">
            {message ?? t("unsaved.message")}
          </p>
          {onSave ? (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onReset}>
                {t("unsaved.reset")}
              </Button>
              <Button ref={main} type="button" size="sm" disabled={saving} onClick={onSave}>
                {saving ? t("common.saving") : t("unsaved.save")}
              </Button>
            </>
          ) : (
            <>
              {onDismiss && (
                <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
                  {t("unsaved.keepEditing")}
                </Button>
              )}
              <Button ref={main} type="button" variant="destructive" size="sm" onClick={onReset}>
                {t("unsaved.discard")}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
