import { useQuery } from "@tanstack/react-query";
import { useCan } from "@bogey/db/permissions";
import type { PluginContext } from "@bogey/plugins/runtime";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { attemptQueryOptions, problemsQueryOptions } from "../db.ts";
import { TestResults } from "./results.tsx";
import { Link, topics, VerdictBadge, type Settings } from "../shared.tsx";

export function ConversationTopic({ eventId, topic }: PluginContext<Settings> & { topic: string }) {
  const parsed = topics.parse(topic);
  const jury = useCan("challenges.jury");
  const problems = useQuery(problemsQueryOptions(eventId));
  const attempt = useQuery({
    ...attemptQueryOptions(eventId, parsed?.id ?? ""),
    enabled: parsed?.kind === "solution",
  });
  if (!parsed) return null;
  const problemId = parsed.kind === "problem" ? parsed.id : attempt.data?.problemId;
  const problem = problems.data?.find((each) => each.id === problemId);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-muted-fg">About</span>
        {problem ? (
          <Link to={jury ? "/jury" : "/problem"} splat={problem.slug} className="link font-medium">
            {problem.label}. {problem.title}
          </Link>
        ) : (
          <span className="font-medium">a problem</span>
        )}
        {attempt.data && (
          <>
            <span className="text-muted-fg">
              · a try in {attempt.data.language}, <RelativeTime value={attempt.data.submittedAt} />
            </span>
            <VerdictBadge attempt={attempt.data} />
          </>
        )}
      </p>
      {parsed.kind === "solution" &&
        (attempt.data ? (
          <TestResults solutionId={attempt.data.id} judged={attempt.data.verdict !== null} />
        ) : (
          attempt.isSuccess && <p className="text-muted-fg">You can't see this try.</p>
        ))}
    </div>
  );
}
