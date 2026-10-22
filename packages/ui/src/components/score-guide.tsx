import { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useUiText } from "../lib/ui-text.ts";
import { cn } from "@bogey/ui/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";
import { Markdown } from "./markdown.tsx";

export interface ScoreBand {
  min: number;
  max: number;
  body: string;
}

export const bandRange = (band: Pick<ScoreBand, "min" | "max">) =>
  band.min === band.max ? String(band.min) : `${band.min}–${band.max}`;

function Band({ band, current }: { band: ScoreBand; current?: boolean }) {
  return (
    <div
      data-current={current || undefined}
      className={cn(
        "grid grid-cols-[3.5rem_1fr] gap-2 rounded-lg px-2 py-1.5 text-sm",
        current ? "bg-muted text-fg" : "text-muted-fg",
      )}
    >
      <span className="font-medium tabular-nums">{bandRange(band)}</span>
      <Markdown className="min-w-0 text-sm">{band.body}</Markdown>
    </div>
  );
}

/** What a criterion's score bands mean: the band the score falls in, and every band on demand. */
export function ScoreGuide({
  bands,
  score,
  className,
}: {
  bands: Tuple<ScoreBand>;
  score: number | null;
  className?: string;
}) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  if (bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const current =
    score === null ? null : (sorted.find((band) => score >= band.min && score <= band.max) ?? null);
  return (
    <div className={cn("flex flex-col gap-1", className)} data-slot="score-guide">
      {current && !open && <Band band={current} current />}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-fg hover:text-fg">
          <IconChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
          {score === null ? t("ui.guidanceShow") : t("ui.guidanceAll")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 pt-1">
            {sorted.map((band) => (
              <Band key={`${band.min}-${band.max}`} band={band} current={band === current} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
