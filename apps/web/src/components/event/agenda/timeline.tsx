import type { ReactNode } from "react";
import { useNow } from "@bogey/ui/hooks/now";
import { IconChevronDown } from "@tabler/icons-react";
import { formatDate, formatDateTime } from "@bogey/utils/time";
import { cn } from "@bogey/ui/lib/utils";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { Facts } from "@bogey/ui/components/facts";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { useT } from "#/lib/translate.tsx";

export type TimelineState = "open" | "upcoming" | "closed";

export interface TimelineItem {
  key: string;
  label: string;
  state: TimelineState;
  start: string | null;
  end: string | null;
  forced?: boolean;
  detail?: ReactNode;
}

const DAY = 86_400_000;

export function Timeline({
  items,
  defaultOpen,
  divided = true,
}: {
  items: Tuple<TimelineItem>;
  defaultOpen?: Tuple<string>;
  divided?: boolean;
}) {
  const t = useT();
  const now = useNow(60_000);
  const time = useTimeFormat();

  const times = items
    .flatMap((item) => [item.start, item.end])
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime());
  const scaled = times.length > 0;
  const low = scaled ? Math.min(...times) : 0;
  const high = Math.max(low + DAY, ...times);
  const pad = (high - low) * 0.04;
  const from = low - pad;
  const span = high + pad - from;
  const at = (value: number) => ((value - from) / span) * 100;
  const nowAt = now === null ? null : Math.min(100, Math.max(0, at(now)));

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "hidden px-2 text-xs text-muted-fg sm:gap-4",
          scaled && "sm:grid sm:grid-cols-[10rem_1fr]",
        )}
      >
        <span />
        <div className="relative h-5">
          {(nowAt === null || nowAt > 22) && (
            <span className="absolute left-0">{formatDate(new Date(from + pad), time)}</span>
          )}
          {nowAt !== null && (
            <span
              className="absolute font-medium whitespace-nowrap text-fg"
              style={{
                left: `${Math.min(97, Math.max(3, nowAt))}%`,
                transform: `translateX(-${Math.min(100, Math.max(0, nowAt))}%)`,
              }}
            >
              {t("timeline.now")}
            </span>
          )}
          {(nowAt === null || nowAt < 78) && (
            <span className="absolute right-0">
              {formatDate(new Date(from + span - pad), time)}
            </span>
          )}
        </div>
      </div>

      <ul
        className={cn(
          "flex flex-col",
          divided ? "divide-y divide-border border-y border-border" : "gap-1",
        )}
      >
        {items.map((item) => (
          <li key={item.key}>
            <Collapsible defaultOpen={defaultOpen?.includes(item.key)}>
              <CollapsibleTrigger
                className={cn(
                  "group grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-lg px-2 py-3 text-left",
                  "sm:grid-cols-[10rem_1fr_auto] hocus:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <StateDot state={item.state} />
                  {item.label}
                </span>
                <span className="order-last col-span-2 sm:order-0 sm:col-span-1">
                  <Track item={item} at={at} nowAt={scaled ? nowAt : null} />
                </span>
                <IconChevronDown className="size-4 text-muted-fg transition-transform group-data-panel-open:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent keepMounted className="px-2 sm:pl-46">
                <div className="flex flex-col gap-3 pb-4 text-sm">
                  <Times item={item} />
                  {item.detail}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Track({
  item,
  at,
  nowAt,
}: {
  item: TimelineItem;
  at: (value: number) => number;
  nowAt: number | null;
}) {
  const start = item.start ? at(new Date(item.start).getTime()) : null;
  const end = item.end ? at(new Date(item.end).getTime()) : null;

  return (
    <span className="relative block h-2.5 rounded-pill bg-muted/60">
      {item.forced ? (
        <span
          className={cn(
            "absolute inset-0 rounded-pill",
            item.state === "open" ? "bg-primary" : "bg-muted-fg/20",
          )}
        />
      ) : start !== null || end !== null ? (
        <span
          className={cn(
            "absolute inset-y-0 rounded-pill",
            item.state === "open" && "bg-primary",
            item.state === "upcoming" && "bg-primary/30",
            item.state === "closed" && "bg-muted-fg/30",
            end === null && "rounded-r-none",
          )}
          style={{ left: `${start ?? 0}%`, right: `${100 - (end ?? 100)}%` }}
        />
      ) : null}
      {nowAt !== null && (
        <span
          aria-hidden
          className="absolute -inset-y-1.5 w-px bg-fg/70"
          style={{ left: `${nowAt}%` }}
        />
      )}
    </span>
  );
}

function Times({ item }: { item: TimelineItem }) {
  const t = useT();
  const time = useTimeFormat();
  if (item.forced) {
    return (
      <p className="text-muted-fg">
        {item.state === "open" ? t("timeline.openedByOrganizer") : t("timeline.closedByOrganizer")}{" "}
        {t("timeline.timesDontApply")}
      </p>
    );
  }
  if (!item.start && !item.end)
    return <p className="text-muted-fg">{t("timeline.notScheduled")}</p>;

  const when = (value: string) => (
    <>
      {formatDateTime(value, time)}{" "}
      <span className="text-muted-fg">
        (<RelativeTime value={value} />)
      </span>
    </>
  );
  return (
    <Facts
      facts={[
        ...(item.start
          ? [
              {
                label: item.state === "upcoming" ? t("timeline.opens") : t("timeline.opened"),
                value: when(item.start),
              },
            ]
          : []),
        {
          label: item.state === "closed" ? t("timeline.closed") : t("timeline.closes"),
          value: item.end ? when(item.end) : t("timeline.whenOrganizerCloses"),
        },
      ]}
    />
  );
}

export function StateDot({ state }: { state: TimelineState }) {
  const t = useT();
  return (
    <span
      role="img"
      aria-label={
        state === "open"
          ? t("timeline.open")
          : state === "upcoming"
            ? t("timeline.upcoming")
            : t("timeline.closed")
      }
      className={cn(
        "inline-block size-2 shrink-0 rounded-pill",
        state === "open" &&
          "bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_25%,transparent)]",
        state === "upcoming" && "border border-primary/60",
        state === "closed" && "bg-muted-fg/40",
      )}
    />
  );
}
