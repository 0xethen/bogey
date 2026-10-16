import { useLocale } from "@bogey/ui/lib/locale";
import { formatDateTime, formatRelative } from "@bogey/utils/time";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { useNow } from "../hooks/now.ts";

export function RelativeTime({ value }: { value: string }) {
  const now = useNow(60_000);
  const locale = useLocale();
  return (
    <time dateTime={value} suppressHydrationWarning>
      {formatRelative(value, now === null ? undefined : new Date(now), locale)}
    </time>
  );
}

/** The date and time, then how far off it is: "Oct 16, 3:00 PM (in 21 minutes)". */
export function ExactTime({ value }: { value: string }) {
  const now = useNow(60_000);
  const locale = useLocale();
  const format = useTimeFormat();
  return (
    <time dateTime={value} suppressHydrationWarning>
      {formatDateTime(value, format)} (
      {formatRelative(value, now === null ? undefined : new Date(now), locale)})
    </time>
  );
}
