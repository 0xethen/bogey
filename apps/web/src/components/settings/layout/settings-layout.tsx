import { useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { IconSearch } from "@tabler/icons-react";
import { usePreference } from "@bogey/db/queries/preferences";
import type { Json } from "@bogey/db/types";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@bogey/ui/components/sidebar";
import { cn } from "@bogey/ui/lib/utils";
import { matchCommand } from "#/lib/commands.ts";
import { useT } from "#/lib/translate.tsx";
import type { SettingsSearchEntry } from "./search-entries.ts";

export interface SettingsPage {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  to: string;
  search?: Record<string, string>;
  exact?: boolean;
  badge?: number;
  /** "default" stands out for something waiting on you; plain text counts otherwise. */
  badgeVariant?: "default" | "text";
  sub?: Tuple<Omit<SettingsPage, "sub">>;
  finds?: Tuple<SettingsSearchEntry>;
}

export interface SettingsGroup {
  label?: string;
  pages: Tuple<SettingsPage>;
}

const isBoolean = (raw: Json): raw is boolean => typeof raw === "boolean";

export function SettingsLayout({
  label,
  header,
  groups,
  className,
  children,
}: {
  label: string;
  header?: ReactNode;
  groups: Tuple<SettingsGroup>;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const open = usePreference("core", "settings_sidebar_open", true, isBoolean);
  return (
    <SidebarProvider
      open={open.value}
      onOpenChange={open.set}
      className={cn("mx-auto max-w-6xl px-4 sm:px-6 lg:gap-8", className)}
    >
      <Sidebar label={label} variant="plain" collapsible="icon" className="lg:py-6">
        <SettingsSidebar header={header} groups={groups} />
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="-mb-4 pt-4">
          <SidebarTrigger className="-ml-2 lg:hidden">{t("settingsNav.menu")}</SidebarTrigger>
          {/* <SidebarTrigger className="-ml-2 hidden lg:inline-flex" /> */}
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

function SettingsSidebar({ header, groups }: { header?: ReactNode; groups: Tuple<SettingsGroup> }) {
  const [query, setQuery] = useState("");
  const results = useSearchResults(groups, query);
  return (
    <>
      <SidebarHeader className="lg:px-0">
        {header}
        <SettingsSearch
          query={query}
          onQueryChange={setQuery}
          first={results[0]}
          count={results.length}
        />
      </SidebarHeader>
      <SidebarContent className="scroll-fade">
        {query.trim() ? (
          <SearchResults results={results} onPick={() => setQuery("")} />
        ) : (
          groups.map((group, index) => (
            <SidebarGroup key={group.label ?? index} className="lg:px-0">
              {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
              <SidebarMenu>
                {group.pages.map((page) => (
                  <NavItem key={page.key} page={page} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
    </>
  );
}

function useCloseOnPick() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

function pageLink(page: Omit<SettingsPage, "sub">, hash?: string) {
  return (
    <Link
      to={page.to}
      search={page.search}
      hash={hash}
      activeOptions={{ exact: page.exact ?? false, includeHash: false }}
    />
  );
}

function NavItem({ page }: { page: SettingsPage }) {
  const close = useCloseOnPick();
  const pathname = useLocation({ select: (location) => location.pathname });
  const Icon = page.icon;
  const subOpen =
    pathname.startsWith(page.to) || page.sub?.some((sub) => pathname.startsWith(sub.to));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={pageLink(page)} tooltip={page.label} onClick={close}>
        <Icon />
        <span>{page.label}</span>
      </SidebarMenuButton>
      {page.badge ? (
        <SidebarMenuBadge variant={page.badgeVariant ?? "text"}>{page.badge}</SidebarMenuBadge>
      ) : null}
      {page.sub && subOpen && (
        <SidebarMenuSub>
          {page.sub.map((sub) => (
            <SidebarMenuSubItem key={sub.key}>
              <SidebarMenuSubButton render={pageLink(sub)} onClick={close}>
                <span>{sub.label}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

interface SearchResult {
  key: string;
  page: Omit<SettingsPage, "sub">;
  entry: SettingsSearchEntry;
  where: string;
}

function useSearchResults(groups: Tuple<SettingsGroup>, query: string): SearchResult[] {
  const router = useRouter();
  const t = useT();
  if (!query.trim()) return [];
  const candidates = groups.flatMap((group) =>
    group.pages
      .flatMap((page) => [page, ...(page.sub ?? [])])
      .flatMap((page) => {
        const [, , route] = router.getMatchedRoutes(page.to);
        const listed = route?.options.staticData?.settings;
        const own: Tuple<SettingsSearchEntry> = [
          ...(typeof listed === "function" ? listed(t) : (listed ?? [])),
          ...(page.finds ?? []),
        ];
        const where = group.label ? `${group.label} › ${page.label}` : page.label;
        return [
          {
            key: page.key,
            page,
            entry: { label: page.label, keywords: group.label ? [group.label] : [] },
            where: group.label ?? "",
          },
          ...own.map((entry) => ({
            key: `${page.key}:${entry.hash ?? entry.label}`,
            page,
            entry,
            where,
          })),
        ];
      }),
  );
  return candidates
    .map((candidate) => ({
      candidate,
      score: matchCommand("", query, [
        candidate.entry.label,
        ...(candidate.entry.keywords ?? []),
        candidate.page.label,
        candidate.entry.description ?? "",
      ]),
    }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 40)
    .map(({ candidate }) => candidate);
}

function SettingsSearch({
  query,
  onQueryChange,
  first,
  count,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  first: SearchResult | undefined;
  count: number;
}) {
  const t = useT();
  const { state, isMobile, setOpen } = useSidebar();
  const navigate = useNavigate();
  const close = useCloseOnPick();
  const input = useRef<HTMLInputElement>(null);

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t("settingsNav.search")}
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            <IconSearch />
            <span>{t("settingsNav.search")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <div className="relative">
      <IconSearch
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-fg"
      />
      <SidebarInput
        ref={input}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            onQueryChange("");
          }
          if (event.key === "Enter" && first) {
            event.preventDefault();
            void navigate({ to: first.page.to, search: first.page.search, hash: first.entry.hash });
            onQueryChange("");
            close();
          }
        }}
        placeholder={t("settingsNav.search")}
        aria-label={t("settingsNav.search")}
        className="pl-8"
      />
      <span role="status" className="sr-only">
        {query.trim() ? t("settingsNav.results", { count }) : ""}
      </span>
    </div>
  );
}

function SearchResults({ results, onPick }: { results: Tuple<SearchResult>; onPick: () => void }) {
  const t = useT();
  const close = useCloseOnPick();
  if (results.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-fg lg:px-1">{t("cmd.empty")}</p>;
  }
  return (
    <SidebarGroup className="lg:px-0">
      <SidebarGroupLabel>{t("settingsNav.resultsHeading")}</SidebarGroupLabel>
      <SidebarMenu>
        {results.map((result) => (
          <SidebarMenuItem key={result.key}>
            <SidebarMenuButton
              render={pageLink(result.page, result.entry.hash)}
              className="h-auto flex-col items-start gap-0 py-1.5 data-[status=active]:bg-transparent data-[status=active]:font-normal"
              onClick={() => {
                onPick();
                close();
              }}
            >
              <span className="w-full truncate text-fg">{result.entry.label}</span>
              {result.where && (
                <span className="w-full truncate text-xs text-muted-fg">{result.where}</span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
