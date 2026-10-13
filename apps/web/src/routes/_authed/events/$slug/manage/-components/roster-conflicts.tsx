import type { RosterConflict, RosterResolutions } from "@bogey/utils/roster";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { WithLineRefs } from "./line-refs.tsx";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "#/lib/translate.tsx";

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
    <Alert>
      <IconAlertTriangle />
      <AlertTitle>{t("conflicts.title", { count: conflicts.length })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-4">
        <ul className="flex flex-col gap-4">
          {conflicts.map((conflict) => (
            <li key={conflict.key} className="flex flex-col gap-2">
              <p className="text-fg mb-0">{conflict.title}</p>
              <ul className="flex flex-col gap-0.5 text-xs">
                {conflict.evidence.map((line) => (
                  <li key={line}>
                    <WithLineRefs text={line} onJump={onJump} />
                  </li>
                ))}
              </ul>
              <OptSelect
                size="sm"
                ariaLabel={conflict.title}
                placeholder={t("conflicts.choose", {
                  suggested:
                    conflict.options.find((option) => option.id === conflict.suggested)?.label ??
                    "",
                })}
                className="max-w-full self-start text-fg"
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
          ))}
        </ul>
        {open.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={takeSuggestions}>
              {t("conflicts.take", { count: open.length })}
            </Button>
            <span className="text-xs">{t("conflicts.askHelp")}</span>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
