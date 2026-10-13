import { createElement, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  definePluginRuntime,
  type PluginContext,
  type PluginRouteContext,
} from "@bogey/plugins/runtime";
import { problemsQueryOptions } from "./db.ts";
import { manifest } from "./manifest.ts";
import { JuryPage, ProblemPage } from "./jury/problem-view.tsx";
import { Problems } from "./contest/problems.tsx";
import { ContestPanel, Scoreboard } from "./contest/scoreboard.tsx";
import { problemSlug } from "./shared.tsx";
import { ConversationTopic } from "./contest/topic.tsx";
import { ManageOverview } from "./contest/overview.tsx";
import { ChallengesPage, ManagePage, ScoreboardPage } from "./ctf/pages.tsx";
import type { Settings } from "./shared.tsx";

function titleFrom(queryClient: QueryClient, eventId: string, splat: string, fallback: string) {
  const slug = problemSlug(splat);
  if (!slug) return fallback;
  if (slug === "new") return "New problem";
  const known = queryClient
    .getQueryData(problemsQueryOptions(eventId).queryKey)
    ?.find((problem) => problem.slug === slug);
  if (known) return known.title;
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function byFormat(
  contest: ComponentType<PluginRouteContext<Settings>>,
  ctf: ComponentType<PluginContext>,
): ComponentType<PluginRouteContext<Settings>> {
  return function FormatPage(context) {
    return context.settings.format === "ctf"
      ? createElement(ctf, context)
      : createElement(contest, context);
  };
}

export default definePluginRuntime(manifest, {
  routes: {
    "": byFormat(Problems, ChallengesPage),
    "/ctf": ChallengesPage,
    "/ctf/manage": ManagePage,
    "/problem": {
      component: ProblemPage,
      title: ({ queryClient, eventId, splat }) => titleFrom(queryClient, eventId, splat, "Problem"),
    },
    "/scoreboard": byFormat(Scoreboard, ScoreboardPage),
    "/jury": {
      component: JuryPage,
      title: ({ queryClient, eventId, splat }) => titleFrom(queryClient, eventId, splat, "Jury"),
    },
  },
  serverRoutes: {
    "POST /problem-package": async (request, ctx) =>
      (await import("./jury/package-routes.ts")).importPackage(request, ctx),
    "GET /problem-package": async (request, ctx) =>
      (await import("./jury/package-routes.ts")).exportPackage(request, ctx),
    "GET /ccs-export": async (request, ctx) =>
      (await import("./format/ccs-routes.ts")).ccsExport(request, ctx),
    "GET /contests/:slug/scoreboard": async (request, ctx) =>
      (await import("./format/ccs-routes.ts")).publicScoreboard(request, ctx),
  },
  homePanels: { contests: ContestPanel },
  slots: { conversationTopic: ConversationTopic, manageOverview: ManageOverview },
});
