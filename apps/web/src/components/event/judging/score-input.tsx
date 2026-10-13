import { useRef, type KeyboardEvent } from "react";
import { cn } from "@bogey/ui/lib/utils";
import { NumberInput } from "@bogey/ui/components/number-field";
import { useT } from "#/lib/translate.tsx";

export function ScoreInput({
  id,
  label,
  value,
  min = 0,
  max,
  disabled,
  onChange,
}: {
  id?: string;
  label: string;
  value: number | null;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const t = useT();
  const group = useRef<HTMLDivElement>(null);

  if (max - min > 10) {
    return (
      <div className="flex items-center gap-2">
        <NumberInput
          id={id}
          aria-label={label}
          min={min}
          max={max}
          step={1}
          scrub={false}
          disabled={disabled}
          className="w-36"
          value={value}
          onValueChange={(next) => {
            if (next !== null) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        <span className="text-sm text-muted-fg">
          {min > 0 ? t("judging.range", { min, max }) : t("judging.outOf", { max })}
        </span>
      </div>
    );
  }

  const choices = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -1
          : 0;
    if (!step || disabled) return;
    event.preventDefault();
    const next = Math.min(max, Math.max(min, (value ?? min - 1) + step));
    onChange(next);
    group.current?.querySelectorAll<HTMLButtonElement>("button")[next - min]?.focus();
  };

  return (
    <div
      ref={group}
      id={id}
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1"
      onKeyDown={move}
    >
      {choices.map((score) => {
        const checked = value === score;
        return (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (value === null && score === min) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(score)}
            className={cn(
              "flex size-9 items-center justify-center rounded-xl border text-sm font-medium tabular-nums transition-colors",
              "disabled:opacity-50",
              checked
                ? "border-primary bg-primary text-primary-fg"
                : "border-border hocus:bg-muted",
            )}
          >
            {score}
          </button>
        );
      })}
    </div>
  );
}
