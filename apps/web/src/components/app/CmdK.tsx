import { useTheme } from "#/lib/theme.ts";
import { useRoleLabel } from "#/lib/roles.ts";
import { sayOr, useSay, useT } from "#/lib/translate.tsx";
import { useState } from "react";
import { useShortcut } from "#/lib/shortcuts.ts";
import { createDialogHandle } from "@bogey/ui/components/dialog";
import { useNavigate, useRouter, type AnyRoute } from "@tanstack/react-router";
import type { Session } from "@bogey/db/auth";
import { useQuery } from "@tanstack/react-query";
import { eventsQueryOptions } from "@bogey/db/queries/events";
import { eventConversationsQueryOptions } from "@bogey/db/queries/messages";
import { ANNOUNCEMENTS } from "#/components/event/messaging/announcements.tsx";
import { visibleConversations } from "#/lib/messaging.ts";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@bogey/ui/components/command";
import {
  groupCommands,
  matchCommand,
  routeCommands,
  type CommandItem as Item,
  type CommandRoute,
} from "#/lib/commands.ts";
import { pluginCommands, pluginTabs } from "#/lib/plugins.ts";
import { installedPlugins, loadedPluginSlots, pluginChromeCommands } from "@bogey/plugins";
import { chats, useEventViewer, useRealEventAccess } from "#/lib/viewer.ts";
import {
  commandMode,
  ISSUES_URL,
  useRegisteredActions,
  type CommandAction,
} from "#/lib/actions.ts";
import { can, setViewAs, useViewAs, VIEW_AS_ROLES } from "@bogey/db/permissions";
import { IconExternalLink } from "@tabler/icons-react";
import { newAnnouncement } from "#/components/event/messaging/announcement-composer.tsx";
import { shortcutsHelp } from "./ShortcutsHelp.tsx";
import { signOutDialog } from "./SignOutDialog.tsx";
import { Kbd } from "@bogey/ui/components/kbd";
import { cn } from "@bogey/ui/lib/utils";

const RECENT_KEY = "bogey:recent-commands";
const RECENT_MAX = 5;

export const cmdK = createDialogHandle<undefined>();

const GROUP_ORDER = [
  "Conversations",
  "Manage",
  "Preview",
  "Events",
  "Pages",
  "Organization",
  "Instance",
  "Account",
  "Appearance",
  "Help",
];

export function CmdK({ session }: { session: Session }) {
  const roleLabel = useRoleLabel();
  const t = useT();
  const say = useSay();
  const groupName = (group: string) => sayOr(t, `cmdGroup.${group}`, group);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<Tuple<string>>([]);
  const router = useRouter();
  const navigate = useNavigate();
  const event = useEventViewer();
  const real = useRealEventAccess();
  const previewing = useViewAs();
  const registered = useRegisteredActions();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const orgId = session.org?.id;
  const events = useQuery({ ...eventsQueryOptions(orgId ?? ""), enabled: open && !!orgId });
  const showHint = !["/", "#"].some((prefix) => search.startsWith(prefix));
  const chatting = !!event && !!real && chats({ access: real.access, chat: event.chat });
  const conversations = useQuery({
    ...eventConversationsQueryOptions(event?.event.id ?? ""),
    enabled: open && chatting,
  });
  const messagesHref = event ? `/events/${event.event.slug}/messages` : "";

  useShortcut("command_menu", () => (cmdK.isOpen ? cmdK.close() : cmdK.open(null)));

  const pages: Item[] = [
    ...routeCommands(commandRoutes(Object.values(router.routesById)), { session, event }, say),
    ...(event
      ? pluginTabs(event.event.slug, event.plugins, event.pluginSettings)
          .filter((tab) => !tab.show || tab.show(event))
          .map((tab) => ({
            href: tab.to,
            label: tab.label,
            group: event.event.name,
            keywords: [tab.label],
          }))
      : []),
    ...(event
      ? pluginCommands(event.event.slug, event.plugins)
          .filter((command) => !command.show || command.show(event))
          .map((command) => ({
            href: command.to,
            label: command.label,
            group: event.event.name,
            keywords: command.keywords,
          }))
      : []),
    ...(event
      ? [
          {
            href: `${messagesHref}?c=${ANNOUNCEMENTS}`,
            label: t("announcements.title"),
            group: "Conversations",
            keywords: ["announcements", "news", "messages"],
          },
        ]
      : []),
    ...(event && chatting
      ? visibleConversations(event.access, conversations.data ?? []).map((conversation) => ({
          href: `${messagesHref}?c=${conversation.id}`,
          label: conversation.subject || conversation.askerName,
          group: "Conversations",
          keywords: [
            conversation.subject,
            conversation.askerName,
            ...conversation.messages.slice(-1).map((message) => message.bodyMd.slice(0, 120)),
          ],
        }))
      : []),
    ...(events.data ?? []).map((summary) => ({
      href: `/events/${summary.slug}`,
      label: summary.name,
      group: "Events",
      keywords: [summary.name, summary.short_name ?? ""],
    })),
  ];

  const issues = ISSUES_URL;
  const manager = !!real && can(real.access, "event.manage");
  const slug = real?.event.slug;
  const actions: CommandAction[] = [
    ...(manager && slug
      ? [
          {
            id: "new-announcement",
            label: t("announcements.new"),
            group: real.event.name,
            keywords: ["post", "announce"],
            run: () => newAnnouncement.open(null),
          },
          ...VIEW_AS_ROLES.filter((role) => role !== previewing).map((role) => ({
            id: `view-as-${role}`,
            label: t("cmd.viewAs", { role: roleLabel(role) }),
            group: "Preview",
            keywords: ["preview", "view as", role],
            run: () => {
              setViewAs(role);
              void navigate({ to: "/events/$slug", params: { slug } });
            },
          })),
        ]
      : []),
    ...(previewing
      ? [
          {
            id: "stop-previewing",
            label: t("nav.stopPreviewing"),
            group: "Preview",
            keywords: ["preview", "view as"],
            run: () => {
              setViewAs(null);
              if (slug) void navigate({ to: "/events/$slug/manage", params: { slug } });
            },
          },
        ]
      : []),
    ...registered,
    {
      id: "switch-theme",
      label: resolvedTheme === "dark" ? t("cmd.themeLight") : t("cmd.themeDark"),
      group: "Appearance",
      keywords: ["theme", "dark mode", "light mode", "appearance", "switch"],
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    },
    ...(theme !== "system"
      ? [
          {
            id: "system-theme",
            label: t("cmd.themeSystem"),
            group: "Appearance",
            keywords: ["theme", "automatic", "appearance", "system"],
            run: () => setTheme("system"),
          },
        ]
      : []),
    {
      id: "shortcuts",
      label: t("shortcut.shortcuts"),
      group: "Help",
      keywords: ["keys", "hotkeys"],
      run: () => shortcutsHelp.open(null),
    },
    ...pluginActions(session),
    ...(issues
      ? [
          {
            id: "report-issue",
            label: t("cmd.reportIssue"),
            group: "Help",
            keywords: ["bug", "feedback", "github"],
            external: true,
            run: () => window.open(issues, "_blank", "noopener"),
          },
        ]
      : []),
    {
      id: "sign-out",
      label: t("nav.signOut"),
      group: "Account",
      keywords: ["log out"],
      run: () => signOutDialog.open(null),
    },
  ];

  const { mode } = commandMode(search);
  const order = [...(event ? [event.event.name] : []), ...GROUP_ORDER];
  const pageGroups = mode === "actions" ? [] : groupCommands(pages, order);
  const actionGroups = mode === "pages" ? [] : groupActions(actions, order);
  const recentItems = recent
    .map((href) => pages.find((item) => item.href === href))
    .filter((item): item is Item => item !== undefined);

  const go = (href: string) => {
    setRecent(writeRecent(href));
    cmdK.close();
    void navigate({ href });
  };
  const run = (action: CommandAction) => {
    cmdK.close();
    action.run();
  };

  return (
    <CommandDialog
      handle={cmdK}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          setRecent(readRecent());
        }
      }}
      title={t("cmd.title")}
      description={t("cmd.description")}
      filter={(value, raw, keywords) => matchCommand(value, commandMode(raw).query, keywords)}
    >
      <CommandInput placeholder={t("cmd.placeholder")} value={search} onValueChange={setSearch} />
      <CommandList className={cn("scroll-fade", showHint && "mb-10")}>
        <CommandEmpty>{t("cmd.empty")}</CommandEmpty>
        {!search && recentItems.length > 0 && (
          <CommandGroup heading={t("cmd.recent")}>
            {recentItems.map((item) => (
              <CommandItem
                key={item.href}
                value={`recent ${item.href}`}
                keywords={[...item.keywords]}
                onSelect={() => go(item.href)}
              >
                {item.label}
                <span className="text-muted-fg">{groupName(item.group)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {pageGroups.map(([heading, groupItems]) => (
          <CommandGroup key={`page ${heading}`} heading={groupName(heading)}>
            {groupItems.map((item) => (
              <CommandItem
                key={item.href}
                value={item.href}
                keywords={[...item.keywords]}
                onSelect={() => go(item.href)}
              >
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {actionGroups.map(([heading, groupActions]) => (
          <CommandGroup
            key={`action ${heading}`}
            heading={t("cmd.actionsOf", { group: groupName(heading) })}
          >
            {groupActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`action ${action.id}`}
                keywords={[action.label, action.group, ...(action.keywords ?? [])]}
                onSelect={() => run(action)}
              >
                {action.label}
                {action.external && (
                  <CommandShortcut>
                    <IconExternalLink />
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      {/* <Separator /> */}
      {showHint && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-muted rounded-b-xl border-t border-t-muted-fg/10">
          <div className="min-h-10 px-4 flex items-center gap-3">
            <p className="bg-muted text-xs font-medium text-muted-foreground">
              <Kbd className="bg-muted-fg/10">/</Kbd> {t("cmd.forActions")}
            </p>
            <p className="bg-muted text-xs font-medium text-muted-foreground">
              <Kbd className="bg-muted-fg/10">#</Kbd> {t("cmd.forPages")}
            </p>
          </div>
        </div>
      )}
    </CommandDialog>
  );
}

function pluginActions(session: Session): CommandAction[] {
  const handlers = new Map(loadedPluginSlots().map(({ key, actions }) => [key, actions] as const));
  return pluginChromeCommands(installedPlugins()).flatMap((command): CommandAction[] => {
    const { href, action } = command;
    const base = {
      id: command.id,
      label: command.label,
      group: command.name,
      keywords: command.keywords,
    };
    if (href !== undefined) {
      return [{ ...base, external: true, run: () => window.open(href, "_blank", "noopener") }];
    }
    const handler = action === undefined ? undefined : handlers.get(command.key)?.[action];
    return handler ? [{ ...base, run: () => handler({ session }) }] : [];
  });
}

function groupActions(
  actions: Tuple<CommandAction>,
  order: Tuple<string>,
): [string, CommandAction[]][] {
  const groups = new Map<string, CommandAction[]>();
  for (const action of actions) {
    const list = groups.get(action.group) ?? [];
    if (!list.some((other) => other.label === action.label)) list.push(action);
    groups.set(action.group, list);
  }
  const rank = (group: string) => {
    const index = order.indexOf(group);
    return index === -1 ? order.length : index;
  };
  return [...groups].toSorted(([a], [b]) => rank(a) - rank(b));
}

function commandRoutes(routes: Tuple<AnyRoute>): CommandRoute[] {
  const made = new Map<string, CommandRoute>();
  const make = (route: AnyRoute): CommandRoute => {
    const existing = made.get(route.id);
    if (existing) return existing;
    const parent: AnyRoute | undefined = route.parentRoute;
    const item: CommandRoute = {
      id: route.id,
      fullPath: route.fullPath,
      staticData: route.options.staticData ?? {},
      parent: parent ? make(parent) : undefined,
    };
    made.set(route.id, item);
    return item;
  };
  return routes.map(make);
}

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeRecent(href: string): string[] {
  const next = [href, ...readRecent().filter((value) => value !== href)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
