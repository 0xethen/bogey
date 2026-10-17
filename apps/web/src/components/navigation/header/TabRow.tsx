import type { EventViewer } from "#/lib/viewer.ts";
import { useT } from "#/lib/translate.tsx";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@bogey/ui/lib/utils";
import { useActiveInView } from "@bogey/ui/hooks/scroll";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@bogey/ui/components/navigation-menu";

export interface RouteTabLink {
  key: string;
  label: string;
  to: string;
}

export interface RouteTab {
  key: string;
  label: string;
  to: string;
  exact?: boolean;
  end?: boolean;
  menu?: Tuple<RouteTabLink>;
}

export interface EventTab extends RouteTab {
  show?: (viewer: EventViewer) => boolean;
  /** Shown only while this window is open, to everyone but organizers. */
  window?: string;
}

export function RouteTabs({ tabs }: { tabs: Tuple<RouteTab> }) {
  const t = useT();
  const row = useActiveInView<HTMLDivElement>();
  if (tabs.length === 0) return null;
  const start = tabs.filter((tab) => !tab.end);
  const end = tabs.filter((tab) => tab.end);
  return (
    <nav
      aria-label={t("nav.sections")}
      className="flex h-(--navbar-height) items-center gap-4 border-b border-border bg-background px-4"
    >
      <div className="min-w-0 scroll-icon-x">
        <div
          ref={row}
          className="flex items-stretch gap-0.5 overflow-x-auto scrollbar-thin scroll-icon-track-x scroll-fade-x scroll-fade-20"
        >
          {start.map((tab) =>
            tab.menu?.length ? (
              <TabMenu key={tab.key} tab={tab} links={tab.menu} />
            ) : (
              <TabLink key={tab.key} tab={tab} />
            ),
          )}
        </div>
      </div>
      {end.length > 0 && (
        <div className="ml-auto flex shrink-0 items-stretch gap-0.5">
          {end.map((tab) => (
            <TabLink key={tab.key} tab={tab} />
          ))}
        </div>
      )}
    </nav>
  );
}

const TAB = cn(
  "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-sm text-muted-fg no-underline transition-colors",
  "hocus:text-fg",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:scale-x-0 after:transition-transform after:duration-100 after:ease-out motion-reduce:after:transition-none",
);

const ACTIVE_TAB = "font-medium text-fg after:scale-x-100 starting:after:scale-x-0";

function TabLink({ tab }: { tab: RouteTab }) {
  return (
    <Link
      to={tab.to}
      activeOptions={{ exact: tab.exact ?? false }}
      activeProps={{ className: ACTIVE_TAB }}
      className={TAB}
    >
      {tab.label}
    </Link>
  );
}

function TabMenu({ tab, links }: { tab: RouteTab; links: Tuple<RouteTabLink> }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const onPage = links.some((link) => pathname === link.to);
  return (
    <NavigationMenu key={pathname} className="max-w-none flex-none items-stretch" delay={100}>
      <NavigationMenuList className="h-full items-stretch">
        <NavigationMenuItem className="flex">
          <NavigationMenuTrigger
            nativeButton={false}
            render={
              <Link
                to={tab.to}
                activeOptions={{ exact: tab.exact ?? false }}
                activeProps={{ className: ACTIVE_TAB }}
              />
            }
            className={cn(
              TAB,
              "h-auto w-auto rounded-none bg-transparent font-normal hover:bg-transparent focus:bg-transparent data-popup-open:bg-transparent data-popup-open:text-fg data-popup-open:hover:bg-transparent",
              onPage && ACTIVE_TAB,
            )}
          >
            {tab.label}
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="flex w-56 flex-col">
              <li>
                <NavigationMenuLink
                  render={<Link to={tab.to} activeOptions={{ exact: tab.exact ?? false }} />}
                  className="py-2 font-medium no-underline"
                >
                  {tab.label}
                </NavigationMenuLink>
              </li>
              {links.map((link) => (
                <li key={link.key}>
                  <NavigationMenuLink render={<Link to={link.to} />} className="py-2 no-underline">
                    {link.label}
                  </NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
