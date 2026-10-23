import { useState } from "react";
import type { EventViewer } from "#/lib/viewer.ts";
import { useT } from "#/lib/translate.tsx";
import { Link, useLocation } from "@tanstack/react-router";
import { IconExternalLink } from "@tabler/icons-react";
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

export interface SectionTabPage {
  key: string;
  label: string;
  to: string;
}

/** One entry in a tab's dropdown; with `pages`, a heading over those links instead. */
export interface SectionTabLink extends SectionTabPage {
  pages?: Tuple<SectionTabPage>;
}

export interface SectionTab {
  key: string;
  label: string;
  to: string;
  exact?: boolean;
  end?: boolean;
  /** Opens in a new browser tab, outside the event's own pages. */
  external?: boolean;
  menu?: Tuple<SectionTabLink>;
}

export interface EventTab extends SectionTab {
  show?: (viewer: EventViewer) => boolean;
  /** Shown only while this window is open, to everyone but organizers. */
  window?: string;
}

const TAB = cn(
  "relative flex h-auto shrink-0 items-center gap-1.5 rounded-none bg-transparent px-3 py-3 text-sm font-normal whitespace-nowrap text-muted-fg no-underline transition-colors",
  "hocus:bg-transparent hocus:text-fg data-popup-open:bg-transparent data-popup-open:text-fg data-popup-open:hover:bg-transparent data-[active=true]:bg-transparent",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:scale-x-0 after:transition-transform after:duration-100 after:ease-out motion-reduce:after:transition-none",
);

const ACTIVE_TAB = "font-medium text-fg after:scale-x-100 starting:after:scale-x-0";

const MENU_LINK =
  "px-2.5 py-1.5 no-underline hover:bg-background focus:bg-background data-[active=true]:bg-background/50 data-[active=true]:hover:bg-background data-[active=true]:focus:bg-background";

const linksIn = (menu: Tuple<SectionTabLink>) =>
  menu.flatMap((link) => (link.pages?.length ? link.pages : [link]));

/** The row of tabs under the menubar: plain tabs are links, tabs with a menu open a dropdown, all in one navigation menu. */
export function SectionTabs({ tabs }: { tabs: Tuple<SectionTab> }) {
  const t = useT();
  const row = useActiveInView<HTMLDivElement>();
  const pathname = useLocation({ select: (location) => location.pathname });
  // a dropdown left open closes once a link in it lands on its page
  const [open, setOpen] = useState<{ value: string | null; on: string }>({ value: null, on: "" });
  const value = open.on === pathname ? open.value : null;
  if (tabs.length === 0) return null;

  const tab = (each: SectionTab) => {
    const menu = each.menu ?? [];
    if (menu.length === 0) {
      return (
        <NavigationMenuItem key={each.key} render={<div />} className="flex">
          {each.external ? (
            <NavigationMenuLink
              render={<a href={each.to} target="_blank" rel="noopener noreferrer" />}
              className={TAB}
            >
              {each.label}
              <IconExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">{t("nav.opensNewTab")}</span>
            </NavigationMenuLink>
          ) : (
            <NavigationMenuLink
              render={
                <Link
                  to={each.to}
                  activeOptions={{ exact: each.exact ?? false }}
                  activeProps={{ className: ACTIVE_TAB }}
                />
              }
              className={TAB}
            >
              {each.label}
            </NavigationMenuLink>
          )}
        </NavigationMenuItem>
      );
    }
    const onPage = linksIn(menu).some((link) => pathname === link.to);
    return (
      <NavigationMenuItem key={each.key} value={each.key} render={<div />} className="flex">
        <NavigationMenuTrigger
          render={
            <Link
              to={each.to}
              activeOptions={{ exact: each.exact ?? false }}
              activeProps={{ className: ACTIVE_TAB }}
            />
          }
          nativeButton={false}
          className={cn(TAB, "w-auto", onPage && ACTIVE_TAB)}
        >
          {each.label}
        </NavigationMenuTrigger>
        <NavigationMenuContent className="p-1.5 pr-1.5">
          <ul className="flex max-h-[min(70vh,32rem)] w-56 flex-col overflow-y-auto overscroll-contain">
            <li>
              <NavigationMenuLink
                render={<Link to={each.to} activeOptions={{ exact: each.exact ?? false }} />}
                className={cn(MENU_LINK, "font-medium")}
              >
                {each.label}
              </NavigationMenuLink>
            </li>
            {menu.map((link) =>
              link.pages?.length ? (
                <li key={link.key} className="mt-1 flex flex-col">
                  <span className="truncate px-2.5 pt-1 pb-0.5 text-xs text-muted-fg">
                    {link.label}
                  </span>
                  <ul className="flex flex-col">
                    {link.pages.map((page) => (
                      <li key={page.key}>
                        <NavigationMenuLink
                          render={<Link to={page.to} activeOptions={{ exact: true }} />}
                          className={MENU_LINK}
                        >
                          {page.label}
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={link.key}>
                  <NavigationMenuLink render={<Link to={link.to} />} className={MENU_LINK}>
                    {link.label}
                  </NavigationMenuLink>
                </li>
              ),
            )}
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
    );
  };

  const start = tabs.filter((each) => !each.end);
  const end = tabs.filter((each) => each.end);
  return (
    <NavigationMenu
      aria-label={t("nav.sections")}
      value={value}
      onValueChange={(next) => setOpen({ value: next, on: pathname })}
      delay={100}
      className="flex h-(--navbar-height) max-w-none items-center justify-start gap-4 border-b border-border bg-background px-4"
    >
      <NavigationMenuList render={<div />} className="contents">
        <div className="min-w-0 scroll-icon-x">
          <div
            ref={row}
            className="flex items-stretch gap-0.5 overflow-x-auto scrollbar-thin scroll-icon-track-x scroll-fade-x scroll-fade-20"
          >
            {start.map(tab)}
          </div>
        </div>
        {end.length > 0 && (
          <div className="ml-auto flex shrink-0 items-stretch gap-0.5">{end.map(tab)}</div>
        )}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
