import type { ReactNode } from "react";
import { cn } from "@bogey/ui/lib/utils";

export interface RankedEntry {
  key: string;
  rank: number;
  title: ReactNode;
  subtitle?: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  highlight?: boolean;
}

export function RankedList({ entries, label }: { entries: Tuple<RankedEntry>; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col divide-y divide-border border-y border-border">
      {entries.map((entry) => (
        <li
          key={entry.key}
          aria-current={entry.highlight || undefined}
          className={cn("flex items-center gap-4 px-2 py-2.5", entry.highlight && "bg-primary/5")}
        >
          <span
            className={cn(
              "w-8 shrink-0 text-right font-heading text-lg font-semibold tabular-nums",
              entry.rank > 3 && "text-muted-fg",
            )}
          >
            {entry.rank}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{entry.title}</span>
            {entry.subtitle && (
              <span className="block truncate text-sm text-muted-fg">{entry.subtitle}</span>
            )}
          </span>
          <span className="shrink-0 text-right text-sm tabular-nums">
            {entry.value}
            {entry.detail && <span className="block text-xs text-muted-fg">{entry.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
