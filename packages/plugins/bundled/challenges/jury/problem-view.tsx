import { useState } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import { useCan } from "@bogey/db/permissions";
import type { PluginRouteContext } from "@bogey/plugins/runtime";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { JuryHome, ProblemEditor } from "./jury.tsx";
import { Workspace } from "../contest/problem.tsx";
import { Link, problemSlug, useProblems, type Settings } from "../shared.tsx";
import { ViewTabs, type View } from "../contest/view-tabs.tsx";

type Context = PluginRouteContext<Settings>;

export function ProblemPage(context: Context) {
  return <ProblemRoute {...context} initial="public" />;
}

export function JuryPage(context: Context) {
  if (!problemSlug(context.splat)) {
    return <JuryHome eventId={context.eventId} settings={context.settings} />;
  }
  return <ProblemRoute {...context} initial="jury" />;
}

function ProblemRoute({ eventId, settings, splat, initial }: Context & { initial: View }) {
  const jury = useCan("challenges.jury");
  const problems = useProblems(eventId, settings.problemOrder);
  const [view, setView] = useState<View>(jury ? initial : "public");
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
          <Button variant="outline" nativeButton={false} render={<Link to="" />}>
            <IconArrowLeft />
            All problems
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <ViewTabs elevated={jury && !creating} view={creating ? "jury" : view} onViewChange={setView}>
      {(current) =>
        current === "public" && problem ? (
          <Workspace key={problem.id} eventId={eventId} settings={settings} problem={problem} />
        ) : (
          <ProblemEditor
            key={problem?.id ?? "new"}
            eventId={eventId}
            settings={settings}
            problem={problem}
          />
        )
      }
    </ViewTabs>
  );
}
