import type { ReactNode } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { useT } from "#/lib/translate.tsx";

export interface Step {
  key: string;
  title: string;
  done: boolean;
  description?: ReactNode;
  actions?: ReactNode[];
}

export function Steps({ title, steps }: { title: string; steps: Tuple<Step> }) {
  const t = useT();
  const done = steps.filter((step) => step.done).length;
  const current = steps.find((step) => !step.done)?.key;

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-fg tabular-nums">
          {done === steps.length
            ? t("steps.allDone")
            : t("steps.progress", { done, total: steps.length })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label={t("steps.progressOf", { title })}
        className="flex gap-1"
      >
        {steps.map((step) => (
          <span
            key={step.key}
            className={cn(
              "h-1.5 flex-1 rounded-pill transition-colors",
              step.done ? "bg-primary" : step.key === current ? "bg-primary/35" : "bg-muted",
            )}
          />
        ))}
      </div>
      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <li key={step.key}>
            <Collapsible defaultOpen={step.key === current}>
              <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hocus:bg-muted/40">
                <StepMark done={step.done} current={step.key === current} index={index + 1} />
                <span
                  className={cn(
                    "flex-1 text-sm font-medium",
                    step.done &&
                      "text-muted-fg/80 not-group-hover:line-through decoration-muted-fg/80",
                  )}
                >
                  {step.title}
                </span>
                {(step.description || step.actions) && (
                  <IconChevronDown className="size-4 text-muted-fg transition-transform group-data-panel-open:rotate-180" />
                )}
              </CollapsibleTrigger>
              {(step.description || step.actions) && (
                <CollapsibleContent className="pr-2 pl-11">
                  <div className="flex flex-col items-start gap-3 pb-3 text-sm text-muted-fg">
                    {step.description}
                    <div className="flex flex-row gap-2">
                      {step.actions?.map((action, i) => (
                        <div key={i}>{action}</div>
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              )}
            </Collapsible>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepMark({ done, current, index }: { done: boolean; current: boolean; index: number }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-pill text-xs font-semibold tabular-nums",
        done && "bg-primary text-primary-fg",
        !done && current && "border-2 border-primary text-fg",
        !done && !current && "border border-border text-muted-fg",
      )}
    >
      {done ? <IconCheck className="size-3.5" stroke={3} /> : index}
    </span>
  );
}
