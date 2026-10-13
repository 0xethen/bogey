import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { useUiText } from "../lib/ui-text.ts";
import { IconArrowsHorizontal, IconMinus, IconPlus } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";

function NumberField({ className, ...props }: NumberFieldPrimitive.Root.Props) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "flex h-9 w-full min-w-0 items-center rounded-3xl border border-transparent bg-input/50 transition-[color,background-color] has-[input:focus-visible]:border-ring has-[input:focus-visible]:focus-ring has-aria-invalid:border-destructive data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "h-full w-full min-w-0 bg-transparent px-1 text-center text-base tabular-nums outline-none placeholder:text-muted-fg md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

const STEP =
  "flex size-9 shrink-0 items-center justify-center rounded-pill text-muted-fg transition-colors hover:text-fg disabled:opacity-40 data-disabled:opacity-40 [&_svg]:size-4";

function NumberFieldDecrement({ className, ...props }: NumberFieldPrimitive.Decrement.Props) {
  const t = useUiText();
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      aria-label={t("ui.decrease")}
      className={cn(STEP, className)}
      {...props}
    >
      <IconMinus />
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberFieldIncrement({ className, ...props }: NumberFieldPrimitive.Increment.Props) {
  const t = useUiText();
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      aria-label={t("ui.increase")}
      className={cn(STEP, className)}
      {...props}
    >
      <IconPlus />
    </NumberFieldPrimitive.Increment>
  );
}

function NumberFieldScrub({ className, ...props }: NumberFieldPrimitive.ScrubArea.Props) {
  const t = useUiText();
  return (
    <NumberFieldPrimitive.ScrubArea
      data-slot="number-field-scrub"
      title={t("ui.scrub")}
      className={cn(
        "flex size-6 shrink-0 cursor-ew-resize items-center justify-center rounded-md text-muted-fg hover:bg-muted hover:text-fg [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      <IconArrowsHorizontal />
      <NumberFieldPrimitive.ScrubAreaCursor className="drop-shadow-sm">
        <IconArrowsHorizontal className="size-4" />
      </NumberFieldPrimitive.ScrubAreaCursor>
    </NumberFieldPrimitive.ScrubArea>
  );
}

function NumberInput({
  id,
  placeholder,
  scrub = false,
  invalid,
  className,
  "aria-label": ariaLabel,
  ...props
}: NumberFieldPrimitive.Root.Props & {
  placeholder?: string;
  scrub?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
}) {
  return (
    <NumberField className={className} {...props}>
      <NumberFieldGroup>
        <NumberFieldDecrement />
        <NumberFieldInput
          id={id}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
        />
        <NumberFieldIncrement />
      </NumberFieldGroup>
      {scrub && <NumberFieldScrub />}
    </NumberField>
  );
}

export {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldScrub,
  NumberInput,
};
