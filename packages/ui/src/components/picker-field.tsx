import { useUiText } from "../lib/ui-text.ts";
import type { ComponentProps, ReactNode } from "react";
import { IconCalendar, IconX } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { InputGroup, InputGroupAddon, InputGroupButton } from "./input-group.tsx";

export function PickerButton({
  className,
  invalid,
  ...props
}: ComponentProps<"button"> & { invalid?: boolean }) {
  return (
    <button
      type="button"
      data-slot="input-group-control"
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-full min-w-0 flex-1 items-center gap-2 rounded-[inherit] px-3 text-left text-sm whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function PickerValue({
  empty,
  children,
  showIcon = true,
}: {
  empty: boolean;
  children: ReactNode;
  showIcon?: boolean;
}) {
  return (
    <>
      {showIcon && <IconCalendar className="size-4 opacity-60" />}
      <span className={cn("truncate", empty && "text-muted-fg")}>{children}</span>
    </>
  );
}

export function PickerField({
  className,
  onClear,
  clearLabel,
  children,
}: {
  className?: string;
  onClear?: () => void;
  clearLabel?: string;
  children: ReactNode;
}) {
  const t = useUiText();
  return (
    <InputGroup className={className}>
      {children}
      {onClear && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={clearLabel ?? t("ui.clear")}
            title={t("ui.clear")}
            onClick={onClear}
          >
            <IconX />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
