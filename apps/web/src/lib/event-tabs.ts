import type { EventTabSetting } from "@bogey/config/settings";
import type { EventPage } from "@bogey/db/queries/pages";
import { isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import type { PluginManifest } from "@bogey/plugins";
import type { EventTab } from "#/components/navigation/header/TabRow.tsx";
import { pluginTabs } from "#/lib/plugins.ts";
import type { PlainKey, T } from "#/lib/translate.tsx";
import {
  checksIn,
  hasAgenda,
  hasResults,
  hasSubmissionPage,
  hasTeamPage,
  judgesOnly,
  manages,
  type EventViewer,
} from "#/lib/viewer.ts";

export const CORE_TAB_AUDIENCE: Record<string, PlainKey> = {
  home: "manageTabs.forEveryone",
  agenda: "manageTabs.forAgenda",
  team: "manageTabs.forTeam",
  submission: "manageTabs.forSubmission",
  messages: "manageTabs.forEveryone",
  checkin: "manageTabs.forCheckin",
  judging: "manageTabs.forJudging",
  results: "manageTabs.forResults",
};

/** Home can be renamed and moved but not hidden; Manage stays last and as it is. */
export const PINNED_TAB = "home";
const MANAGE_TAB = "manage";

export function eventTabs(
  slug: string,
  plugins: Tuple<PluginManifest>,
  pluginSettings: Record<string, Record<string, unknown>>,
  pages: Tuple<EventPage>,
  t: T,
): EventTab[] {
  const base = `/events/${slug}`;
  return [
    {
      key: "home",
      label: t("eventTab.home"),
      to: base,
      exact: true,
      menu: pages.map((page) => ({
        key: page.id,
        label: page.title,
        to: `${base}/pages/${page.slug}`,
      })),
    },
    { key: "agenda", label: t("eventTab.agenda"), to: `${base}/agenda`, show: hasAgenda },
    { key: "team", label: t("eventTab.team"), to: `${base}/team`, show: hasTeamPage },
    {
      key: "submission",
      label: t("eventTab.submission"),
      to: `${base}/submission`,
      show: hasSubmissionPage,
    },
    { key: "messages", label: t("eventTab.messages"), to: `${base}/messages` },
    { key: "checkin", label: t("eventTab.checkin"), to: `${base}/checkin`, show: checksIn },
    { key: "judging", label: t("eventTab.judging"), to: `${base}/judging`, show: judgesOnly },
    { key: "results", label: t("eventTab.results"), to: `${base}/results`, show: hasResults },
    ...pluginTabs(slug, plugins, pluginSettings),
    {
      key: MANAGE_TAB,
      label: t("eventTab.manage"),
      to: `${base}/manage`,
      show: manages,
      end: true,
    },
  ];
}

export interface ArrangedTab extends EventTab {
  /** The tab's own name, before an organizer renamed it. */
  defaultLabel: string;
  hidden: boolean;
}

/** Whether organizers can arrange a tab at all (Manage can't be). */
export const isArrangeable = (tab: Pick<EventTab, "key">) => tab.key !== MANAGE_TAB;

/**
 * Applies the event's `tabs` setting: listed tabs in its order, renamed, hidden or kept to a
 * window; a tab it doesn't list (a plugin enabled since) keeps its place after the tab before it.
 */
export function arrangeTabs(tabs: Tuple<EventTab>, items: Tuple<EventTabSetting>): ArrangedTab[] {
  const settings = new Map(items.map((item) => [item.key, item]));
  const order: EventTab[] = items.flatMap(
    (item) => tabs.find((tab) => tab.key === item.key && isArrangeable(tab)) ?? [],
  );
  tabs.forEach((tab, index) => {
    if (order.includes(tab)) return;
    const before = tabs
      .slice(0, index)
      .findLast((earlier) => order.includes(earlier) && isArrangeable(earlier));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, tab);
  });
  return order.map((tab) => {
    const own = isArrangeable(tab) ? settings.get(tab.key) : undefined;
    const window = tab.key === PINNED_TAB ? undefined : (own?.window ?? tab.window);
    return {
      ...tab,
      label: own?.label?.trim() || tab.label,
      defaultLabel: tab.label,
      hidden: tab.key !== PINNED_TAB && (own?.hidden ?? false),
      window: window || undefined,
    };
  });
}

/** The tabs this viewer sees now: their role's, minus hidden ones and those whose window is shut. */
export function visibleTabs(tabs: Tuple<ArrangedTab>, viewer: EventViewer, now = new Date()) {
  return tabs.filter(
    (tab) =>
      !tab.hidden &&
      (!tab.show || tab.show(viewer)) &&
      (!tab.window ||
        manages(viewer) ||
        isWindowOpen(windowByKey(viewer.windows, tab.window), now)),
  );
}

/** What to store for a tab: only what differs from how it comes. */
export function tabSetting(tab: ArrangedTab, base: EventTab): EventTabSetting {
  return {
    key: tab.key,
    ...(tab.hidden ? { hidden: true } : {}),
    ...(tab.label !== tab.defaultLabel ? { label: tab.label } : {}),
    ...(tab.window !== base.window ? { window: tab.window ?? "" } : {}),
  };
}
