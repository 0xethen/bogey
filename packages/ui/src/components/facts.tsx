import type { ReactNode } from "react";
import { cn } from "@bogey/ui/lib/utils";

export interface Fact {
  label: string;
  value: ReactNode;
}

export function Facts({ facts, className }: { facts: Tuple<Fact>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm", className)}>
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-muted-fg">{fact.label}</dt>
          <dd className="min-w-0 break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
