import { createElement, useEffect, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { definePluginRuntime, type PluginRouteContext } from "@bogey/plugins/runtime";
import { problemsQueryOptions } from "./db.ts";
import { manifest } from "./manifest.ts";
import { JuryPage, ProblemPage } from "./jury/problem-view.tsx";
import { Problems } from "./contest/problems.tsx";
import { Submissions } from "./contest/tries.tsx";
import { ContestPanel, Scoreboard } from "./contest/scoreboard.tsx";
import { problemSlug, useGoTo } from "./shared.tsx";
import { ConversationTopic } from "./contest/topic.tsx";
import { ManageOverview } from "./contest/overview.tsx";
import { LanguagesControl } from "./contest/languages-control.tsx";
import { ChallengesPage, ScoreboardPage } from "./ctf/pages.tsx";
import { CtfJuryPage } from "./ctf/jury.tsx";
import { BankPage } from "./bank/bank.tsx";
import { juryChallengesQueryOptions } from "./ctf/database.ts";
import type { Settings } from "./shared.tsx";
import { withChallenges } from "./context.tsx";

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
  ctf: ComponentType<PluginRouteContext<Settings>>,
): ComponentType<PluginRouteContext<Settings>> {
  return function FormatPage(context) {
    return context.settings.format === "ctf"
      ? createElement(ctf, context)
      : createElement(contest, context);
  };
}

// the list at /problems, a problem at /problems/<slug>
function ProblemsRoute(context: PluginRouteContext<Settings>) {
  return problemSlug(context.splat)
    ? createElement(ProblemPage, context)
    : createElement(Problems, context);
}

function challengeTitle(queryClient: QueryClient, eventId: string, splat: string) {
  const id = problemSlug(splat);
  if (!id) return "Jury";
  if (id === "new") return "New challenge";
  return (
    queryClient
      .getQueryData(juryChallengesQueryOptions(eventId).queryKey)
      ?.find((challenge) => challenge.id === id)?.title ?? "Challenge"
  );
}

function ToJury() {
  const goTo = useGoTo();
  useEffect(() => {
    void goTo("/jury", { replace: true });
  }, [goTo]);
  return null;
}

// the plugin's root and the old /problem/<slug> addresses go to /problems
function ToProblems({ splat }: PluginRouteContext<Settings>) {
  const goTo = useGoTo();
  useEffect(() => {
    void goTo("/problems", { splat: problemSlug(splat), replace: true });
  }, [goTo, splat]);
  return null;
}

// Results was renamed Submissions; old links still land
function ToSubmissions({ splat }: PluginRouteContext<Settings>) {
  const goTo = useGoTo();
  useEffect(() => {
    void goTo("/submissions", { splat: problemSlug(splat), replace: true });
  }, [goTo, splat]);
  return null;
}

export default definePluginRuntime(manifest, {
  routes: {
    "": withChallenges(byFormat(ToProblems, ChallengesPage)),
    "/problems": {
      component: withChallenges(ProblemsRoute),
      title: ({ queryClient, eventId, splat }) =>
        titleFrom(queryClient, eventId, splat, "Problems"),
    },
    "/submissions": withChallenges(Submissions),
    "/results": ToSubmissions,
    "/ctf": withChallenges(ChallengesPage),
    "/ctf/manage": ToJury,
    "/problem": ToProblems,
    "/scoreboard": withChallenges(byFormat(Scoreboard, ScoreboardPage)),
    "/bank": BankPage,
    "/jury": {
      component: withChallenges(byFormat(JuryPage, CtfJuryPage)),
      title: ({ queryClient, eventId, splat, settings }) =>
        settings.format === "ctf"
          ? challengeTitle(queryClient, eventId, splat)
          : titleFrom(queryClient, eventId, splat, "Jury"),
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
  slots: {
    conversationTopic: ConversationTopic,
    manageOverview: ManageOverview,
    settingControls: { languages: LanguagesControl },
  },
});
