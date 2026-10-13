import type { RouteTitle } from "#/lib/routing.ts";
import type { Text } from "#/lib/translate.tsx";
import type { Viewer } from "#/lib/viewer.ts";

export interface CommandOption {
  label?: Text;
  keywords?: Tuple<string>;
  group?: Text | ((viewer: Viewer) => Text);
  when?: (viewer: Viewer) => boolean;
}

export interface CommandRoute {
  id: string;
  fullPath: string;
  staticData: { title?: RouteTitle; command?: CommandOption | false };
  parent?: CommandRoute;
}

export interface CommandItem {
  href: string;
  label: string;
  group: string;
  keywords: Tuple<string>;
}

const DEFAULT_GROUP = "Pages";

export type Say = (text: Text) => string;

const asIs: Say = (text) => (typeof text === "string" ? text : text.message);

function ancestry(route: CommandRoute): CommandRoute[] {
  const chain: CommandRoute[] = [];
  for (let at: CommandRoute | undefined = route; at; at = at.parent) chain.push(at);
  return chain;
}

function labelOf(route: CommandRoute, say: Say): string | undefined {
  const { command, title } = route.staticData;
  if (command && command.label) return say(command.label);
  if (title === undefined) return undefined;
  return say(typeof title === "string" || "message" in title ? title : title.page);
}

export function routeCommands(
  routes: Tuple<CommandRoute>,
  viewer: Viewer,
  say: Say = asIs,
  defaultGroup: string = DEFAULT_GROUP,
): CommandItem[] {
  const byPath = new Map<string, CommandRoute[]>();
  for (const route of routes) {
    if (!route.id.startsWith("/_authed/")) continue;
    const path = route.fullPath.replace(/(.)\/$/, "$1");
    if (path.replace("$slug", "").includes("$")) continue;
    if (path.includes("$slug") && !viewer.event) continue;
    byPath.set(path, [...(byPath.get(path) ?? []), route]);
  }

  const items: CommandItem[] = [];
  for (const [path, candidates] of byPath) {
    const ordered = candidates.toSorted((a, b) => b.id.length - a.id.length);
    if (ordered[0]?.staticData.command === false) continue;
    const route = ordered.find((candidate) => labelOf(candidate, say));
    if (!route) continue;

    const chain = ancestry(route);
    const options = chain
      .map((at) => at.staticData.command)
      .filter((command): command is CommandOption => !!command);
    if (options.some((option) => option.when && !option.when(viewer))) continue;

    const grouping = options.find((option) => option.group)?.group;
    const group =
      grouping === undefined
        ? defaultGroup
        : say(typeof grouping === "function" ? grouping(viewer) : grouping);
    const label = labelOf(route, say) ?? path;
    const own = route.staticData.command;
    items.push({
      href: viewer.event ? path.replace("$slug", viewer.event.event.slug) : path,
      label,
      group,
      keywords: [...new Set([label, group, ...((own && own.keywords) || [])])],
    });
  }
  return items;
}

export function groupCommands(
  items: Tuple<CommandItem>,
  order: Tuple<string>,
): [string, CommandItem[]][] {
  const groups = new Map<string, CommandItem[]>();
  for (const item of items) {
    const list = groups.get(item.group) ?? [];
    if (!list.some((other) => other.label === item.label)) list.push(item);
    groups.set(item.group, list);
  }
  const rank = (group: string) => {
    const index = order.indexOf(group);
    return index === -1 ? order.length : index;
  };
  return [...groups].toSorted(([a], [b]) => rank(a) - rank(b));
}

export function matchCommand(_value: string, search: string, keywords: Tuple<string> = []): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const text = keywords.join(" ").toLowerCase();
  const starts = text.split(/[^a-z0-9]+/);
  if (!words.every((word) => starts.some((start) => start.startsWith(word)))) return 0;
  return keywords[0]?.toLowerCase().startsWith(words[0] ?? "") ? 1 : 0.5;
}
