import { createContext, use, type ComponentType } from "react";
import type { PluginRouteContext } from "@bogey/plugins/runtime";
import type { Settings } from "./shared.tsx";

/** What every page of the contest shares: the event, its organization and the plugin's settings. */
export interface ChallengesContext {
  eventId: string;
  orgId: string | null;
  settings: Settings;
}

const Context = createContext<ChallengesContext | null>(null);

export function useChallenges(): ChallengesContext {
  const value = use(Context);
  if (!value) throw new Error("useChallenges needs a challenges route");
  return value;
}

// wraps a route page so everything under it can call useChallenges
export function withChallenges(
  Page: ComponentType<PluginRouteContext<Settings>>,
): ComponentType<PluginRouteContext<Settings>> {
  function ChallengesRoute(context: PluginRouteContext<Settings>) {
    const value = {
      eventId: context.eventId,
      orgId: context.session.org?.id ?? null,
      settings: context.settings,
    };
    return (
      <Context value={value}>
        <Page {...context} />
      </Context>
    );
  }
  return ChallengesRoute;
}
