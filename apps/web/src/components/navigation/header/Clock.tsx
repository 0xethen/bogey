import { isWindowOpen } from "@bogey/db/queries/windows";
import { useNow } from "@bogey/ui/hooks/now";
import { cn } from "@bogey/ui/lib/utils";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { formatTime } from "@bogey/utils/time";
import { useEventViewer } from "#/lib/viewer.ts";
import { isSubmissionWindow } from "#/lib/windows.ts";
import { useT } from "#/lib/translate.tsx";

export function Clock({ placement }: { placement: "center" | "end" }) {
  const t = useT();
  const now = useNow(1000);
  const event = useEventViewer();
  const format = useTimeFormat();
  if (now === null) return null;

  const at = new Date(now);
  const closing = event?.windows
    .filter((window) => isSubmissionWindow(window.key) && isWindowOpen(window, at))
    .flatMap((window) => (window.closes_at ? [new Date(window.closes_at).getTime()] : []))
    .filter((closes) => closes > now)
    .toSorted((a, b) => a - b)[0];

  if (closing !== undefined) {
    return (
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          placement === "center" ? "hidden sm:inline" : "sm:hidden",
        )}
        role="timer"
        aria-live="off"
      >
        <span className="hidden sm:inline text-muted-fg">
          {event?.countdownLabel ?? t("clock.closeIn")}{" "}
        </span>
        {formatRemaining(closing - now)}
      </span>
    );
  }
  if (placement === "end") return null;

  return (
    <time
      className="hidden sm:inline text-sm text-muted-fg tabular-nums"
      dateTime={at.toISOString()}
      title={format.timeZone}
    >
      {formatTime(at, format)}
    </time>
  );
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));

  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600) % 24;
  const days = Math.floor(total / 86400);

  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");

  return days > 0 ? `${days}d ${clock}` : clock;
}
