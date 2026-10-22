import { IconCheck } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { useT } from "#/lib/translate.tsx";

export function Stepper({
  steps,
  current,
  className,
  onSelect,
}: {
  steps: Tuple<{ key: string; title: string }>;
  current: number;
  className?: string;
  /** Makes each step a button that moves to it. */
  onSelect?: (index: number) => void;
}) {
  const t = useT();
  return (
    <ol className={cn("flex items-center gap-2", className)} aria-label={t("steps.label")}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const mark = (
          <>
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-pill text-xs font-medium tabular-nums",
                done && "bg-primary text-primary-fg",
                active && "border-2 border-primary text-primary-text",
                !done && !active && "border border-border text-muted-fg",
              )}
            >
              {done ? <IconCheck className="size-3.5" aria-label={t("judging.done")} /> : index + 1}
            </span>
            <span
              className={cn(
                "truncate text-sm",
                active ? "font-medium" : "text-muted-fg",
                !active && "hidden sm:inline",
              )}
            >
              {step.title}
            </span>
          </>
        );
        return (
          <li
            key={step.key}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                className="flex min-w-0 items-center gap-2 rounded-lg hocus:text-fg"
              >
                {mark}
              </button>
            ) : (
              mark
            )}
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn("h-px min-w-4 flex-1", done ? "bg-primary" : "bg-border")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
