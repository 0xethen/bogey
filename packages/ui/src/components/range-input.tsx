import { useUiText } from "../lib/ui-text.ts";
import { useState } from "react";
import { NumberInput } from "./number-field.tsx";
import { Slider } from "./slider.tsx";

export type Range = [number, number];

const SCALES = [10, 20, 50, 100, 200, 500, 1000];

function scaleFor(value: number, max: number): number {
  return Math.min(max, SCALES.find((scale) => scale >= value) ?? max);
}

export function RangeInput({
  id,
  value,
  onValueChange,
  onBlur,
  min = 0,
  max = 100,
  labels,
  invalid,
}: {
  id?: string;
  value: Range;
  onValueChange: (value: Range) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  labels?: [string, string];
  invalid?: boolean;
}) {
  const t = useUiText();
  const names = labels ?? [t("ui.lowest"), t("ui.highest")];
  const [low, high] = value;
  const [end, setEnd] = useState(() => scaleFor(Number.isNaN(high) ? min : high, max));
  const shown: Range = [
    Number.isNaN(low) ? min : Math.min(low, end - 1),
    Number.isNaN(high) ? end : Math.min(high, end),
  ];
  return (
    <div className="flex flex-col gap-3" onBlur={onBlur}>
      <Slider
        value={shown}
        min={min}
        max={end}
        minStepsBetweenValues={1}
        thumbLabels={names}
        onValueChange={(next) => {
          if (Array.isArray(next) && next.length === 2) onValueChange([next[0], next[1]]);
        }}
      />
      <div className="flex items-center gap-2 text-sm text-muted-fg">
        <NumberInput
          id={id}
          aria-label={names[0]}
          className="w-32"
          scrub={false}
          min={min}
          max={max - 1}
          value={Number.isNaN(low) ? null : low}
          onValueChange={(next) => onValueChange([next ?? Number.NaN, high])}
          invalid={invalid}
        />
        to
        <NumberInput
          aria-label={names[1]}
          className="w-32"
          scrub={false}
          min={min + 1}
          max={max}
          value={Number.isNaN(high) ? null : high}
          onValueChange={(next) => {
            if (next !== null) setEnd((current) => Math.max(current, scaleFor(next, max)));
            onValueChange([low, next ?? Number.NaN]);
          }}
          invalid={invalid}
        />
      </div>
    </div>
  );
}
