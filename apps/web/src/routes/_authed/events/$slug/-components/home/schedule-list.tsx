import { isWindowOpen, type EventWindow } from "@bogey/db/queries/windows";
import { useT } from "#/lib/translate.tsx";
import { useLocale } from "@bogey/ui/lib/locale";
import { formatDateTime, formatRelative } from "@bogey/utils/time";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { useNow } from "@bogey/ui/hooks/now";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { windowLabel } from "#/lib/windows.ts";

export function ScheduleList({
  windows,
  upcoming: withUpcoming = true,
}: {
  windows: Tuple<EventWindow>;
  upcoming?: boolean;
}) {
  const now = useNow(60_000);
  const time = useTimeFormat();
  const t = useT();
  const locale = useLocale();
  const current = now === null ? undefined : new Date(now);
  const open = windows
    .filter((window) => isWindowOpen(window))
    .sort((a, b) => (a.closes_at ?? "9999").localeCompare(b.closes_at ?? "9999"));
  const upcoming = windows
    .filter(
      (window) =>
        withUpcoming &&
        !isWindowOpen(window) &&
        window.override === null &&
        window.opens_at !== null &&
        now !== null &&
        new Date(window.opens_at).getTime() > now,
    )
    .sort((a, b) => (a.opens_at ?? "").localeCompare(b.opens_at ?? ""));

  if (!open.length && !upcoming.length) {
    return withUpcoming ? (
      <p className="text-sm text-muted-fg">{t("schedule.nothingOpen")}</p>
    ) : null;
  }

  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border">
      {open.map((window) => (
        <li key={window.key} className="flex items-center gap-3 px-2 py-3 text-sm">
          <StatusDot tone="done" label={t("schedule.open")} />
          <span className="flex-1 font-medium">{windowLabel(window)}</span>
          <span className="text-right text-muted-fg">
            {window.closes_at && window.override === null ? (
              <>
                {t("schedule.openUntil", { when: formatDateTime(window.closes_at, time) })}
                <span className="block text-xs">
                  {t("schedule.closes", {
                    when: formatRelative(window.closes_at, current, locale),
                  })}
                </span>
              </>
            ) : (
              t("schedule.openNow")
            )}
          </span>
        </li>
      ))}
      {upcoming.map((window) => (
        <li key={window.key} className="flex items-center gap-3 px-2 py-3 text-sm">
          <StatusDot tone="idle" label={t("schedule.upcoming")} />
          <span className="flex-1 font-medium">{windowLabel(window)}</span>
          <span className="text-right text-muted-fg">
            {t("schedule.opens", { when: formatDateTime(window.opens_at ?? "", time) })}
            <span className="block text-xs">
              {formatRelative(window.opens_at ?? "", current, locale)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
