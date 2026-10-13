import { useUiText, type UiText } from "../lib/ui-text.ts";
import type { DateRange as DayRange } from "react-day-picker";
import { formatLocalDate, parseLocalDate } from "@bogey/ui/lib/utils";
import { useIsMobile } from "@bogey/ui/hooks/media";
import { Calendar } from "./calendar.tsx";
import { PickerButton, PickerField, PickerValue } from "./picker-field.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

export interface DateRange {
  from?: string;
  to?: string;
}

const FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function describe(range: DateRange, placeholder: string, t: UiText): string {
  const from = range.from ? parseLocalDate(range.from) : undefined;
  const to = range.to ? parseLocalDate(range.to) : undefined;
  if (from && to) return `${FORMAT.format(from)} – ${FORMAT.format(to)}`;
  if (from) return t("ui.from", { date: FORMAT.format(from) });
  if (to) return t("ui.until", { date: FORMAT.format(to) });
  return placeholder;
}

export function DateRangePicker({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string;
  value: DateRange;
  onChange: (next: DateRange) => void;
  placeholder?: string;
  className?: string;
}) {
  const t = useUiText();
  const mobile = useIsMobile();
  const selected: DayRange | undefined = value.from
    ? { from: parseLocalDate(value.from), to: value.to ? parseLocalDate(value.to) : undefined }
    : undefined;
  const empty = !value.from && !value.to;

  return (
    <PickerField
      className={className}
      onClear={empty ? undefined : () => onChange({})}
      clearLabel={t("ui.clearDates")}
    >
      <Popover>
        <PopoverTrigger render={<PickerButton id={id} />}>
          <PickerValue empty={empty}>
            {describe(value, placeholder ?? t("ui.anyDate"), t)}
          </PickerValue>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={mobile ? 1 : 2}
            selected={selected}
            defaultMonth={selected?.from}
            onSelect={(next) =>
              onChange({
                from: next?.from ? formatLocalDate(next.from) : undefined,
                to: next?.to ? formatLocalDate(next.to) : undefined,
              })
            }
          />
        </PopoverContent>
      </Popover>
    </PickerField>
  );
}
