import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconList, IconSelector } from "@tabler/icons-react";
import { eventsQueryOptions, type Event, type EventSummary } from "@bogey/db/queries/events";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bogey/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@bogey/ui/components/sidebar";
import { useT } from "#/lib/translate.tsx";

function Mark({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary font-heading text-sm font-semibold text-primary-fg"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function EventSwitcher({ event, orgAdmin }: { event: Event; orgAdmin: boolean }) {
  const t = useT();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const events = useQuery(eventsQueryOptions(event.org_id));
  const base = `/events/${event.slug}/manage`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const managed = (events.data ?? []).filter(
    (other: EventSummary) => orgAdmin || other.myRole === "organizer" || other.id === event.id,
  );
  const live = managed.filter((other) => !other.is_template);
  const templates = managed.filter((other) => other.is_template);
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };

  const item = (other: EventSummary) => {
    const href: string = `/events/${other.slug}/manage${rest}`;
    return (
      <DropdownMenuItem key={other.id} render={<Link to={href} onClick={close} />}>
        <span className="min-w-0 flex-1 truncate">{other.name}</span>
        {other.id === event.id && <IconCheck className="ml-auto" />}
      </DropdownMenuItem>
    );
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={event.name}
                className="h-12 px-2 py-1 data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-fg group-data-[collapsible=icon]:p-0!"
              />
            }
          >
            <Mark name={event.name} />
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate font-medium text-fg">{event.name}</span>
              <span className="truncate text-xs">
                {event.slug} {event.is_template && `(${t("eventSwitcher.template")})`}
              </span>
            </span>
            <IconSelector className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            className="max-h-96 min-w-60"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("orgTab.events")}</DropdownMenuLabel>
              {events.isPending && (
                <DropdownMenuItem disabled>{t("common.loading")}</DropdownMenuItem>
              )}
              {live.map(item)}
            </DropdownMenuGroup>
            {templates.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("eventSwitcher.templates")}</DropdownMenuLabel>
                {templates.map(item)}
              </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to="/events" onClick={close} />}>
                <IconList />
                {t("audit.allEvents")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
