import type { RosterConflict, RosterResolutions } from "@bogey/utils/roster";
import { Button } from "@bogey/ui/components/button";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "#/lib/translate.tsx";
import { LineRefs } from "./line-refs.tsx";

// a long roster can raise dozens; they scroll inside the box so the page doesn't
export function RosterConflicts({
  conflicts,
  resolutions,
  onChange,
  onJump,
}: {
  conflicts: Tuple<RosterConflict>;
  resolutions: RosterResolutions;
  onChange: (next: RosterResolutions) => void;
  onJump?: (line: number) => void;
}) {
  const t = useT();
  const open = conflicts.filter((conflict) => !(conflict.key in resolutions));
  const takeSuggestions = () =>
    onChange({
      ...resolutions,
      ...Object.fromEntries(open.map((conflict) => [conflict.key, conflict.suggested])),
    });

  return (
    <section
      aria-label={t("conflicts.title", { count: conflicts.length })}
      className="flex flex-col rounded-2xl border border-border bg-card text-sm"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <IconAlertTriangle className="size-4 shrink-0 text-warning" />
        <span className="min-w-0 flex-1 font-medium">
          {t("conflicts.title", { count: conflicts.length })}
        </span>
        {conflicts.length > 1 && (
          <span className="text-xs text-muted-fg tabular-nums">
            {t("conflicts.decided", {
              done: conflicts.length - open.length,
              count: conflicts.length,
            })}
          </span>
        )}
        {open.length > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={takeSuggestions}>
            {t("conflicts.take", { count: open.length })}
          </Button>
        )}
      </header>
      <ul className="flex max-h-[min(30rem,60vh)] flex-col divide-y divide-border overflow-y-auto overscroll-contain px-4">
        {conflicts.map((conflict) => {
          const decided = conflict.key in resolutions;
          return (
            <li
              key={conflict.key}
              className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 gap-2.5">
                <StatusDot
                  tone={decided ? "done" : "attention"}
                  label={decided ? t("conflicts.isDecided") : t("conflicts.toDecide")}
                  className="mt-1.5"
                />
                <div className="flex min-w-0 flex-col">
                  <p className="mb-0 text-fg">{conflict.title}</p>
                  <ul className="flex flex-col text-xs/5 text-muted-fg">
                    {conflict.evidence.map((each) => (
                      <li key={`${each.lines.join(",")}:${each.text}`}>
                        <LineRefs lines={each.lines} onJump={onJump} />
                        {each.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <OptSelect
                size="sm"
                ariaLabel={conflict.title}
                placeholder={t("conflicts.choose", {
                  suggested:
                    conflict.options.find((option) => option.id === conflict.suggested)?.label ??
                    "",
                })}
                className="max-w-full shrink-0 self-start text-fg sm:w-64"
                value={resolutions[conflict.key] ?? null}
                options={conflict.options.map((option) => ({
                  value: option.id,
                  label:
                    option.id === conflict.suggested
                      ? t("conflicts.suggestedOption", { label: option.label })
                      : option.label,
                  description: option.description,
                }))}
                onChange={(choice) => onChange({ ...resolutions, [conflict.key]: choice })}
              />
            </li>
          );
        })}
      </ul>
      {open.length > 0 && (
        <p className="mb-0 border-t border-border px-4 py-2 text-xs text-muted-fg">
          {t("conflicts.askHelp")}
        </p>
      )}
    </section>
  );
}
