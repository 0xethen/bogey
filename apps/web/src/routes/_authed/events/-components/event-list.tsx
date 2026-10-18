import { useRoleLabel } from "#/lib/roles.ts";
import { Suspense, use, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EventSummary } from "@bogey/db/queries/events";
import { useT } from "#/lib/translate.tsx";
import { useLocale } from "@bogey/ui/lib/locale";
import { dateParts, formatDateRange, formatRelative } from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { cn } from "@bogey/ui/lib/utils";
import { IconChevronRight } from "@tabler/icons-react";
import { Item } from "@bogey/ui/components/item";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { findPlugin, loadPluginRuntime, readPluginSettings } from "@bogey/plugins";
import type { JsonRecord } from "@bogey/db/types";
import type { EventListIcons } from "#/lib/plugins.ts";

export function EventList({
  events,
  icons = {},
  to,
  showRole = false,
}: {
  events: Tuple<EventSummary>;
  icons?: EventListIcons;
  to: "home" | "manage";
  showRole?: boolean;
}) {
  const [now] = useState(() => new Date());
  const time = useTimeFormat();
  const t = useT();
  const roleLabel = useRoleLabel();
  const locale = useLocale();
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => {
        const live =
          !!event.starts_at &&
          new Date(event.starts_at) <= now &&
          (!event.ends_at || new Date(event.ends_at) > now);
        const soon = !!event.starts_at && new Date(event.starts_at) > now;
        return (
          <li key={event.id}>
            <Item
              render={
                to === "manage" ? (
                  <Link to="/events/$slug/manage" params={{ slug: event.slug }} />
                ) : (
                  <Link to="/events/$slug" params={{ slug: event.slug }} />
                )
              }
            >
              <Item.Media>
                <DateBlock value={event.starts_at} />
              </Item.Media>
              <Item.Content>
                <Item.Title className="max-w-full">
                  <span className="truncate">{event.name}</span>
                  {Object.entries(icons[event.id] ?? {}).map(([key, settings]) => (
                    <Suspense key={key}>
                      <PluginListIcon pluginKey={key} eventId={event.id} stored={settings} />
                    </Suspense>
                  ))}
                  {event.visibility !== "public" && (
                    <Badge variant="outline">
                      {event.visibility === "draft" ? t("events.draft") : t("events.unlisted")}
                    </Badge>
                  )}
                </Item.Title>
                <Item.Description className="line-clamp-1">
                  {[formatDateRange(event.starts_at, event.ends_at, time), event.location]
                    .filter(Boolean)
                    .join(", ") || t("events.noDates")}
                </Item.Description>
              </Item.Content>
              <Item.Actions>
                {live ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-primary-text">
                    <span className="size-2 animate-pulse rounded-pill bg-primary" />
                    <span>
                      <span className="hidden lg:inline">{t("events.happeningNow")}</span>
                      <span className="lg:hidden">{t("events.now")}</span>
                    </span>
                  </span>
                ) : soon && event.starts_at ? (
                  <span className="hidden text-sm text-muted-fg sm:inline">
                    {t("events.starts", { when: formatRelative(event.starts_at, now, locale) })}
                  </span>
                ) : null}
                {showRole && event.myRole && (
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {roleLabel(event.myRole)}
                  </Badge>
                )}
                <IconChevronRight className="size-4 shrink-0 text-muted-fg" />
              </Item.Actions>
            </Item>
          </li>
        );
      })}
    </ul>
  );
}

/** What a plugin shows beside an event's name, like Lockdown's padlock. */
function PluginListIcon({
  pluginKey,
  eventId,
  stored,
}: {
  pluginKey: string;
  eventId: string;
  stored: JsonRecord;
}) {
  const manifest = findPlugin(pluginKey);
  const Icon = use(loadPluginRuntime(pluginKey))?.slots.eventListIcon;
  return manifest && Icon ? (
    <Icon eventId={eventId} settings={readPluginSettings(manifest, stored)} />
  ) : null;
}

function DateBlock({ value, className }: { value: string | null; className?: string }) {
  const time = useTimeFormat();
  if (!value) {
    return (
      <span
        aria-hidden
        className={cn("size-12 shrink-0 rounded-xl border border-dashed border-border", className)}
      />
    );
  }
  const { month, day } = dateParts(value, time);
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-border bg-card leading-none",
        className,
      )}
    >
      <span className="text-[0.625rem] font-semibold tracking-wider text-primary-text uppercase">
        {month}
      </span>
      <span className="font-heading text-lg font-semibold tabular-nums">{day}</span>
    </span>
  );
}
