import { useUiText } from "../lib/ui-text.ts";
import { Calendar } from "./calendar.tsx";
import { Input } from "./input.tsx";
import { PickerButton, PickerField, PickerValue } from "./picker-field.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";
import { Field, FieldDescription, FieldError, FieldLabel } from "./field.tsx";
import { formatLocalDate, parseLocalDate } from "../lib/utils.ts";

export function DateTimeField({
  label,
  value,
  onChange,
  description,
  error,
  id,
  showIcon,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  description?: string;
  error?: string | null;
  id: string;
  showIcon?: boolean;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DateTimeInput
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        invalid={!!error}
        showIcon={showIcon}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function DateTimeInput({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
  showIcon = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  showIcon?: boolean;
}) {
  const t = useUiText();
  const [date = "", time = ""] = value.split("T");
  const selected = date ? parseLocalDate(date) : undefined;

  const set = (nextDate: string, nextTime: string) =>
    onChange(nextDate ? `${nextDate}T${nextTime || "00:00"}` : "");

  return (
    <div className="flex gap-2">
      <PickerField
        className="flex-1"
        onClear={value ? () => onChange("") : undefined}
        clearLabel={t("ui.clearNamed", { name: label })}
      >
        <Popover onOpenChange={(open) => !open && onBlur?.()}>
          <PopoverTrigger render={<PickerButton id={id} invalid={invalid} />}>
            <PickerValue empty={!selected} showIcon={showIcon}>
              {selected
                ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(selected)
                : t("ui.pickDate")}
            </PickerValue>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(next) => set(next ? formatLocalDate(next) : "", time)}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </PickerField>

      <Input
        type="time"
        aria-label={`${label} time`}
        aria-invalid={invalid || undefined}
        className="w-28 shrink-0"
        value={time}
        disabled={!date}
        onChange={(event) => set(date, event.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}
