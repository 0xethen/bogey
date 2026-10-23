import { IconArrowLeft } from "@tabler/icons-react";
import { useCan } from "@bogey/db/permissions";
import type { PluginRouteContext } from "@bogey/plugins/runtime";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { JuryHome } from "./jury.tsx";
import { ProblemEditor } from "./problem-editor.tsx";
import { Workspace } from "../contest/problem.tsx";
import {
  Link,
  problemSlug,
  splatTab,
  useLiveContest,
  useProblems,
  type Settings,
} from "../shared.tsx";

type Context = PluginRouteContext<Settings>;

export function ProblemPage(context: Context) {
  return <ProblemRoute {...context} view="public" />;
}

export function JuryPage(context: Context) {
  useLiveContest(context.eventId);
  if (!problemSlug(context.splat)) {
    return <JuryHome eventId={context.eventId} settings={context.settings} />;
  }
  return <ProblemRoute {...context} view="jury" />;
}

// /problems/<slug> is what participants see; /jury/<slug>/<tab> edits it. Each links to the other.
function ProblemRoute({
  eventId,
  settings,
  splat,
  session,
  view,
}: Context & { view: "public" | "jury" }) {
  const jury = useCan("challenges.jury");
  const problems = useProblems(eventId, settings.problemOrder);
  const slug = problemSlug(splat);
  const creating = jury && slug === "new";
  const problem = problems.data?.find((each) => each.slug === slug);

  if (problems.isPending) return <Screen.Skeleton width="wide" layout="columns" />;
  if (!creating && !problem) {
    return (
      <Screen title="Problem not found" width="narrow">
        <p className="text-sm text-muted-fg">
          It may have been renamed or hidden, or the contest hasn't started.
        </p>
        <div>
          <Button variant="outline" nativeButton={false} render={<Link to="/problems" />}>
            <IconArrowLeft />
            All problems
          </Button>
        </div>
      </Screen>
    );
  }

  if (problem && (view === "public" || !jury)) {
    return <Workspace key={problem.id} eventId={eventId} settings={settings} problem={problem} />;
  }
  return (
    <ProblemEditor
      key={problem?.id ?? "new"}
      eventId={eventId}
      orgId={session.org?.id ?? null}
      settings={settings}
      problem={problem}
      tab={splatTab(splat)}
    />
  );
}
