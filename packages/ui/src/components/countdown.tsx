import * as React from "react";
import { cn } from "@bogey/ui/lib/utils";

// 9 above 0 and 0 below 9, so the spring's overshoot shows a neighbor instead of a gap
const STRIP = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/** One digit as a vertical strip of 0-9 that springs to `digit`. */
function RollingDigit({ digit }: { digit: number }) {
  return (
    <span
      data-slot="rolling-digit"
      className="relative inline-block h-[1lh] w-[1ch] overflow-hidden text-center align-top"
    >
      <span
        className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-600 ease-[cubic-bezier(0.34,1.4,0.64,1)] will-change-transform motion-reduce:transition-none"
        style={{ transform: `translateY(calc(${-(digit + 1)} * 1lh))` }}
      >
        {STRIP.map((each, index) => (
          <span key={index} className="block h-[1lh]">
            {each}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Digits of a whole number, keyed from the right so a new leading digit doesn't re-roll the rest. */
function Digits({ value, padStart }: { value: number; padStart: number }) {
  const text = String(Math.max(0, Math.floor(Math.abs(value)))).padStart(padStart, "0");
  return (
    <>
      {[...text].map((char, index) => (
        <RollingDigit key={text.length - index} digit={Number(char)} />
      ))}
    </>
  );
}

/** A whole number whose digits roll to each new value. */
function RollingNumber({
  value,
  padStart = 1,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  value: number;
  /** Pads with leading zeros to at least this many digits. */
  padStart?: number;
}) {
  const text = String(Math.floor(Math.abs(value))).padStart(padStart, "0");
  return (
    <span
      data-slot="rolling-number"
      role="img"
      aria-label={value < 0 ? `-${text}` : text}
      className={cn("inline-flex font-mono tabular-nums", className)}
      {...props}
    >
      <span aria-hidden className="inline-flex">
        {value < 0 && <span className="text-muted-fg">-</span>}
        <Digits value={value} padStart={padStart} />
      </span>
    </span>
  );
}

type CountdownUnit = "days" | "hours" | "minutes" | "seconds";
const UNITS: readonly CountdownUnit[] = ["days", "hours", "minutes", "seconds"];

/** Whole days, hours, minutes and seconds in `ms`, ignoring its sign. */
function splitDuration(ms: number): Record<CountdownUnit, number> {
  const total = Math.floor(Math.abs(ms) / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor(total / 3600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
  };
}

function shownUnits(parts: Record<CountdownUnit, number>, units?: readonly CountdownUnit[]) {
  if (units) return UNITS.filter((unit) => units.includes(unit));
  if (parts.days > 0) return UNITS;
  if (parts.hours > 0) return UNITS.slice(1);
  return UNITS.slice(2);
}

/**
 * Time left in rolling digits. Below zero it counts up as overtime, with a leading "+" and
 * `data-overtime` set for styling. `units` fixes which units show; otherwise empty leading ones drop.
 */
function Countdown({
  ms,
  units,
  labels,
  layout = "clock",
  padStart = 2,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  ms: number;
  units?: readonly CountdownUnit[];
  /** Each unit's name: under it in blocks, and as the separator after days in a clock. */
  labels?: Partial<Record<CountdownUnit, string>>;
  layout?: "clock" | "blocks";
  /** Digits the leading unit pads to; the rest always pad to 2. */
  padStart?: number;
}) {
  const parts = splitDuration(ms);
  const shown = shownUnits(parts, units);
  const overtime = ms < 0;
  const pad = (index: number) => (index === 0 ? padStart : 2);
  const spoken =
    (overtime ? "+" : "") +
    shown.map((unit, index) => String(parts[unit]).padStart(pad(index), "0")).join(":");

  if (layout === "blocks") {
    return (
      <div
        data-slot="countdown"
        role="timer"
        aria-live="off"
        aria-label={spoken}
        data-overtime={overtime ? "" : undefined}
        className={cn("grid auto-cols-fr grid-flow-col gap-2", className)}
        {...props}
      >
        {shown.map((unit, index) => (
          <div
            key={unit}
            aria-hidden
            className="flex flex-col items-center rounded-2xl border border-border bg-muted/40 py-3"
          >
            <span className="inline-flex font-mono text-2xl font-semibold tabular-nums">
              <Digits value={parts[unit]} padStart={pad(index)} />
            </span>
            {labels?.[unit] && <span className="text-xs text-muted-fg">{labels[unit]}</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      data-slot="countdown"
      role="timer"
      aria-live="off"
      aria-label={spoken}
      data-overtime={overtime ? "" : undefined}
      className={cn("inline-flex items-baseline font-mono tabular-nums", className)}
      {...props}
    >
      <span aria-hidden className="inline-flex">
        {overtime && <span className="text-muted-fg">+</span>}
        {shown.map((unit, index) => (
          <React.Fragment key={unit}>
            {index > 0 && (
              <span className="text-muted-fg">
                {shown[index - 1] === "days" && labels?.days ? `${labels.days} ` : ":"}
              </span>
            )}
            <Digits value={parts[unit]} padStart={pad(index)} />
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

export { Countdown, RollingNumber, splitDuration, type CountdownUnit };
