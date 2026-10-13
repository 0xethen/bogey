import { useQuery } from "@tanstack/react-query";
import { teamFeedbackQueryOptions } from "@bogey/db/queries/team-feedback";
import { Markdown } from "@bogey/ui/components/markdown";
import { Meter } from "@bogey/ui/components/meter";
import { Screen } from "@bogey/ui/components/screen";
import { useT } from "#/lib/translate.tsx";

export function TeamFeedback({ submissionId }: { submissionId: string }) {
  const t = useT();
  const { data } = useQuery(teamFeedbackQueryOptions(submissionId));
  if (!data || (data.notes.length === 0 && data.scores.length === 0)) return null;
  const rounds = [...new Set(data.scores.map((row) => row.roundName))];

  return (
    <Screen.Section id="from-the-judges" title={t("feedback.title")}>
      {rounds.map((round) => (
        <div key={round} className="flex flex-col gap-3">
          {rounds.length > 1 && <h3 className="text-sm font-medium">{round}</h3>}
          <ul className="flex flex-col gap-3">
            {data.scores
              .filter((row) => row.roundName === round)
              .map((row) => (
                <li key={row.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{row.label}</span>
                    <span className="text-muted-fg">
                      {t("feedback.average", {
                        average: row.average,
                        max: row.maxScore,
                        judges: row.judges,
                      })}
                    </span>
                  </div>
                  <Meter
                    aria-label={row.label}
                    value={row.average}
                    min={row.minScore}
                    max={row.maxScore}
                  />
                </li>
              ))}
          </ul>
        </div>
      ))}
      {data.notes.map((note) => (
        <Markdown key={note.id} className="typeset">
          {note.body}
        </Markdown>
      ))}
    </Screen.Section>
  );
}
