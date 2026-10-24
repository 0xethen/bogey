import { useState } from "react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { useUiText } from "../lib/ui-text.ts";
import { IconArrowsHorizontal, IconMinus, IconPlus } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";

type RootProps = NumberFieldPrimitive.Root.Props;

const STEP =
  "flex size-9 shrink-0 items-center justify-center rounded-pill text-muted-fg transition-colors hover:text-fg disabled:opacity-40 data-disabled:opacity-40 [&_svg]:size-4";

function Scrub() {
  const t = useUiText();
  return (
    <NumberFieldPrimitive.ScrubArea
      data-slot="number-field-scrub"
      title={t("ui.scrub")}
      className="flex size-6 shrink-0 cursor-ew-resize items-center justify-center rounded-md text-muted-fg hover:bg-muted hover:text-fg [&_svg]:size-3.5"
    >
      <IconArrowsHorizontal />
      <NumberFieldPrimitive.ScrubAreaCursor className="drop-shadow-sm">
        <IconArrowsHorizontal className="size-4" />
      </NumberFieldPrimitive.ScrubAreaCursor>
    </NumberFieldPrimitive.ScrubArea>
  );
}

// with an empty label, 0 shows as an empty field and an empty field means 0
function useEmptyAsZero(
  emptyLabel: string | undefined,
  {
    value,
    defaultValue,
    onValueChange,
    onBlur,
  }: Pick<RootProps, "value" | "defaultValue" | "onValueChange" | "onBlur">,
): Pick<RootProps, "value" | "defaultValue" | "onValueChange" | "onBlur"> {
  const [own, setOwn] = useState<number | null>(defaultValue ?? null);
  // what's in the field while it's being edited; undefined once it's left
  const [typed, setTyped] = useState<number | null | undefined>(undefined);
  if (emptyLabel === undefined) return { value, defaultValue, onValueChange, onBlur };
  const current = value !== undefined ? value : own;
  return {
    value: typed !== undefined ? typed : current === 0 ? null : current,
    onValueChange: (next, details) => {
      setTyped(next);
      setOwn(next ?? 0);
      onValueChange?.(next ?? 0, details);
    },
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setTyped(undefined);
      onBlur?.(event);
    },
  };
}

/** A number with − and + buttons. See docs/architecture/ui-conventions.md#fields. */
function NumberInput({
  id,
  placeholder,
  scrub = false,
  emptyLabel,
  invalid,
  className,
  value,
  defaultValue,
  onValueChange,
  onBlur,
  "aria-label": ariaLabel,
  ...props
}: RootProps & {
  placeholder?: string;
  /** A drag handle before the field that changes the value. */
  scrub?: boolean;
  /** Where 0 means "no limit" or "off": a 0 shows as an empty field reading this, and empty is 0. */
  emptyLabel?: string;
  invalid?: boolean;
  "aria-label"?: string;
}) {
  const values = useEmptyAsZero(emptyLabel, { value, defaultValue, onValueChange, onBlur });
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
      {...values}
    >
      {scrub && <Scrub />}
      <NumberFieldPrimitive.Group
        data-slot="number-field-group"
        className="flex h-9 w-full min-w-0 items-center rounded-3xl border border-transparent bg-input/50 transition-[color,background-color] has-[input:focus-visible]:border-ring has-[input:focus-visible]:focus-ring has-aria-invalid:border-destructive data-disabled:opacity-50"
      >
        <Step kind="decrement" />
        <NumberFieldPrimitive.Input
          data-slot="number-field-input"
          id={id}
          placeholder={emptyLabel ?? placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className="h-full w-full min-w-0 bg-transparent px-1 text-center text-base tabular-nums outline-none placeholder:text-muted-fg md:text-sm"
        />
        <Step kind="increment" />
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );
}

function Step({ kind }: { kind: "decrement" | "increment" }) {
  const t = useUiText();
  return kind === "decrement" ? (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      aria-label={t("ui.decrease")}
      className={STEP}
    >
      <IconMinus />
    </NumberFieldPrimitive.Decrement>
  ) : (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      aria-label={t("ui.increase")}
      className={STEP}
    >
      <IconPlus />
    </NumberFieldPrimitive.Increment>
  );
}

export { NumberInput };
