import { jsonRecord } from "@bogey/db/types";
import type { PluginServerContext } from "@bogey/plugins/runtime";
import {
  ccsScoreboard,
  ccsSnapshot,
  parseBoard,
  type CcsContest,
  type CcsJudging,
  type CcsRun,
  type CcsSolution,
} from "./ccs.ts";
import type { ChallengesDatabase } from "../db.ts";
import { manifest } from "../manifest.ts";

const reply = (status: number, error: string): Response => Response.json({ error }, { status });

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

async function contestOf(
  ctx: PluginServerContext,
  eventId: string,
  name: string,
): Promise<CcsContest> {
  const [window, resolved] = await Promise.all([
    ctx.supabase
      .from("event_windows")
      .select("opens_at, closes_at")
      .eq("event_id", eventId)
      .eq("key", "challenges.contest")
      .maybeSingle(),
    ctx.supabase.rpc("settings_for", { p_namespaces: ["plugin.challenges"], p_event: eventId }),
  ]);
  const settings = jsonRecord(jsonRecord(resolved.data)["plugin.challenges"]);
  const opens = window.data?.opens_at ?? null;
  const closes = window.data?.closes_at ?? null;
  return {
    id: eventId,
    name,
    startsAt: opens,
    durationMs: opens && closes ? new Date(closes).getTime() - new Date(opens).getTime() : null,
    freezeMinutes: numberOr(settings.freezeMinutes, manifest.settings.freezeMinutes.default),
    penaltyMinutes: numberOr(settings.penaltyMinutes, manifest.settings.penaltyMinutes.default),
  };
}

export async function publicScoreboard(
  request: Request,
  ctx: PluginServerContext,
): Promise<Response> {
  const slug = ctx.params.slug ?? "";
  const orgSlug = new URL(request.url).searchParams.get("org");
  let query = ctx.supabase.from("events").select("id, name, org_id").eq("slug", slug).limit(2);
  if (orgSlug) {
    const org = await ctx.supabase.from("orgs").select("id").eq("slug", orgSlug).maybeSingle();
    if (!org.data) return reply(404, "not found");
    query = query.eq("org_id", org.data.id);
  }
  const events = await query;
  if (events.error) return reply(500, "failed");
  const event = events.data[0];
  if (!event) return reply(404, "not found");
  if (events.data.length > 1) {
    return reply(409, "More than one organization has that event. Add ?org=<organization>.");
  }

  const board = await ctx.supabaseFor<ChallengesDatabase>().rpc("challenges_scoreboard", {
    p_event: event.id,
    p_jury: false,
  });
  if (board.error) {
    return board.error.code === "42501"
      ? reply(403, "The scoreboard is not public yet.")
      : reply(500, "failed");
  }
  const parsed = parseBoard(board.data);
  if (!parsed) return reply(500, "failed");
  const contest = await contestOf(ctx, event.id, event.name);
  return Response.json(ccsScoreboard(parsed, contest, new Date()));
}

export async function ccsExport(_request: Request, ctx: PluginServerContext): Promise<Response> {
  if (!ctx.user) return reply(401, "Sign in first.");
  if (!ctx.eventId) return reply(400, "Name the event with ?event=.");
  const eventId = ctx.eventId;
  const db = ctx.supabaseFor<ChallengesDatabase>();

  const board = await db.rpc("challenges_scoreboard", { p_event: eventId, p_jury: true });
  if (board.error) return reply(403, "Only the jury can export a contest.");
  const parsed = parseBoard(board.data);
  if (!parsed) return reply(500, "failed");

  const event = await ctx.supabase.from("events").select("name").eq("id", eventId).maybeSingle();
  const [languages, problems, tests, teams, solutions, judgings, runs, contest] = await Promise.all(
    [
      db.from("challenges_languages").select("key, name"),
      db.from("challenges_problems").select("id, time_limit_ms").eq("event_id", eventId),
      db.from("challenges_testcases").select("id, problem_id, ordinal").eq("event_id", eventId),
      ctx.supabase.from("teams").select("id, name").eq("event_id", eventId),
      db
        .from("challenges_solutions")
        .select("id, problem_id, team_id, language_key, submitted_at")
        .eq("event_id", eventId)
        .not("team_id", "is", null)
        .order("submitted_at"),
      db
        .from("challenges_judgings")
        .select("id, solution_id, verdict, started_at, finished_at")
        .eq("event_id", eventId)
        .eq("valid", true)
        .in("status", ["done", "failed"]),
      db.from("challenges_judging_runs").select("id, judging_id, testcase_id, verdict, time_ms"),
      contestOf(ctx, eventId, event.data?.name ?? "Contest"),
    ],
  );
  const failed = [languages, problems, tests, teams, solutions, judgings, runs].find(
    (result) => result.error,
  );
  if (failed) return reply(500, "failed");

  const testCounts = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const test of tests.data ?? []) {
    testCounts.set(test.problem_id, (testCounts.get(test.problem_id) ?? 0) + 1);
    ordinals.set(test.id, test.ordinal);
  }
  const submissions: CcsSolution[] = (solutions.data ?? []).flatMap((solution) =>
    solution.team_id
      ? [
          {
            id: solution.id,
            problemId: solution.problem_id,
            teamId: solution.team_id,
            languageKey: solution.language_key,
            submittedAt: solution.submitted_at,
          },
        ]
      : [],
  );
  const known = new Set(submissions.map((solution) => solution.id));
  const judgements: CcsJudging[] = (judgings.data ?? [])
    .filter((judging) => known.has(judging.solution_id))
    .map((judging) => ({
      id: judging.id,
      solutionId: judging.solution_id,
      verdict: judging.verdict,
      startedAt: judging.started_at,
      finishedAt: judging.finished_at,
    }));
  const judged = new Set(judgements.map((judging) => judging.id));
  const results: CcsRun[] = (runs.data ?? [])
    .filter((run) => judged.has(run.judging_id))
    .map((run) => ({
      id: run.id,
      judgingId: run.judging_id,
      ordinal: ordinals.get(run.testcase_id) ?? 0,
      verdict: run.verdict,
      timeMs: run.time_ms,
    }));

  const snapshot = ccsSnapshot({
    contest,
    languages: languages.data ?? [],
    problems: (problems.data ?? []).map((problem) => ({
      id: problem.id,
      timeLimitMs: problem.time_limit_ms,
      tests: testCounts.get(problem.id) ?? 0,
    })),
    teams: teams.data ?? [],
    solutions: submissions,
    judgings: judgements,
    runs: results,
    board: parsed,
    now: new Date(),
  });
  const logged = await db.rpc("challenges_log_ccs_export", { p_event: eventId });
  if (logged.error) return reply(500, "failed");
  return new Response(JSON.stringify(snapshot, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="contest-${eventId}.json"`,
    },
  });
}
