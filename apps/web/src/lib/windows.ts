import { isWindowOpen, type EventWindow } from "@bogey/db/queries/windows";
import type { TimelineItem } from "#/components/event/agenda/timeline.tsx";
import { installedPlugins, pluginWindows } from "@bogey/plugins";
import type { ResolvedValue } from "@bogey/config/settings";
import { CORE_WINDOW_INFO } from "@bogey/config/windows";
import { sayOr, type T } from "#/lib/translate.tsx";

const LABELS: Record<string, string> = Object.fromEntries(
  CORE_WINDOW_INFO.map((window) => [window.key, window.label]),
);

export const CORE_WINDOWS: Tuple<string> = CORE_WINDOW_INFO.map((window) => window.key);

let pluginLabels: Map<string, string> | undefined;

function pluginWindowLabels(): Map<string, string> {
  pluginLabels ??= new Map(
    pluginWindows(installedPlugins()).map((window) => [window.key, window.label]),
  );
  return pluginLabels;
}

export const SUBMISSION_WINDOW = /^submit-(.+)$/;

export function isSubmissionWindow(key: string): boolean {
  return key === "submissions" || SUBMISSION_WINDOW.test(key);
}

export function windowLabel(window: Pick<EventWindow, "key">, t?: T): string {
  const own = SUBMISSION_WINDOW.exec(window.key)?.[1];
  if (own) {
    const words = own.replace(/-/g, " ");
    const form = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
    return t ? t("window.ownSubmissions", { form }) : `${form} submissions`;
  }
  const english = LABELS[window.key] ?? pluginWindowLabels().get(window.key) ?? window.key;
  return t ? sayOr(t, `window.${window.key}`, english) : english;
}

export function timelineItems(
  windows: Tuple<EventWindow>,
  detail?: (window: EventWindow) => TimelineItem["detail"],
  now: Date = new Date(),
  t?: T,
): TimelineItem[] {
  return [...windows]
    .sort(
      (a, b) =>
        (a.opens_at ?? "9999").localeCompare(b.opens_at ?? "9999") ||
        CORE_WINDOWS.indexOf(a.key) - CORE_WINDOWS.indexOf(b.key),
    )
    .map((window) => ({
      key: window.key,
      label: windowLabel(window, t),
      state: isWindowOpen(window, now)
        ? "open"
        : !window.override && window.opens_at && new Date(window.opens_at) > now
          ? "upcoming"
          : "closed",
      start: window.opens_at,
      end: window.closes_at,
      forced: window.override !== null,
      detail: detail?.(window),
    }));
}

export interface Milestone {
  key: string;
  windows: Tuple<string>;
  at: string;
  opens: boolean;
}

export function milestoneLabel(milestone: Milestone, t: T, locale: string): string {
  const names = milestone.windows.map((key) => windowLabel({ key }, t));
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  const one = names.length === 1;
  if (milestone.opens)
    return one ? t("milestone.opens", { names: list }) : t("milestone.opensMany", { names: list });
  return one ? t("milestone.closes", { names: list }) : t("milestone.closesMany", { names: list });
}

export function windowMilestones(
  windows: Tuple<EventWindow>,
  hidden: Tuple<string> = [],
): Milestone[] {
  const moments = new Map<string, { at: string; opens: boolean; windows: EventWindow[] }>();
  const add = (window: EventWindow, at: string | null, opens: boolean) => {
    if (!at) return;
    const key = `${new Date(at).getTime()}:${opens ? "opens" : "closes"}`;
    const moment = moments.get(key) ?? { at, opens, windows: [] };
    moment.windows.push(window);
    moments.set(key, moment);
  };
  for (const window of windows) {
    if (window.override !== null || hidden.includes(window.key)) continue;
    add(window, window.opens_at, true);
    add(window, window.closes_at, false);
  }
  return [...moments]
    .map(([key, moment]) => ({
      key,
      windows: moment.windows.map((window) => window.key),
      at: moment.at,
      opens: moment.opens,
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function agendaMilestones(
  windows: Tuple<EventWindow>,
  schedule: Pick<ResolvedValue<"schedule">, "display" | "hiddenWindows">,
): Milestone[] {
  return schedule.display === "hidden" ? [] : windowMilestones(windows, schedule.hiddenWindows);
}
