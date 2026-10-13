import * as React from "react";

import { cn } from "@bogey/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bogey/ui/components/select";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function OptSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  size = "default",
  variant = "default",
  className,
  ariaLabel,
}: {
  id?: string;
  value: T | null;
  options: Tuple<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: React.ReactNode;
  size?: "sm" | "default";
  variant?: "default" | "muted";
  className?: string;
  ariaLabel?: string;
}) {
  const items = React.useMemo(
    () => options.map((option) => ({ value: option.value, label: option.label })),
    [options],
  );

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        variant={variant}
        aria-label={ariaLabel}
        className={cn("w-fit", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.description ? (
              <span className="flex flex-col gap-0.5 py-0.5">
                <span>{option.label}</span>
                <span className="text-xs font-normal text-muted-fg">{option.description}</span>
              </span>
            ) : (
              option.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
