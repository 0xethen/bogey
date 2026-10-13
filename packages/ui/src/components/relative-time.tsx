import { useLocale } from "@bogey/ui/lib/locale";
import { formatRelative } from "@bogey/utils/time";
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
