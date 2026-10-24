import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { groupResults, publishedResultsQueryOptions } from "@bogey/db/queries/judging";
import { myTeamQueryOptions } from "@bogey/db/queries/teams";
import { Button } from "@bogey/ui/components/button";
import { AwardCard } from "#/components/event/judging/prize-card.tsx";
import { formatDateTime } from "@bogey/utils/time";
import { Markdown } from "@bogey/ui/components/markdown";
import { Notice, NoticeList } from "#/routes/_authed/events/$slug/results/-components/notice.tsx";
import { RankedList } from "#/components/event/judging/ranked-list.tsx";
import { Screen } from "@bogey/ui/components/screen";
import { hasResults, inEvent } from "#/lib/viewer.ts";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/results/")({
  staticData: { title: msg("results.title"), command: { when: inEvent(hasResults) } },
  loader: ({ context }) =>
    context.query.query({ ...publishedResultsQueryOptions(context.event.id), staleTime: "static" }),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const time = useTimeFormat();
  const { event, access } = Route.useRouteContext();
  const { data: results } = useSuspenseQuery(publishedResultsQueryOptions(event.id));
  const team = useQuery({
    ...myTeamQueryOptions(event.id),
    enabled: access.role === "participant",
  });
  const myTeam = team.data?.team.id;

  if (!results) {
    return (
      <Screen title={t("results.title")} width="narrow">
        <p className="text-sm text-muted-fg">{t("results.notReleased")}</p>
      </Screen>
    );
  }

  const groups = groupResults(results.rows);
  const mine = results.rows.filter((row) => row.teamId === myTeam);

  return (
    <Screen
      title={t("results.title")}
      description={t("results.published", { when: formatDateTime(results.publishedAt, time) })}
      width="narrow"
      actions={
        <>
          {results.awards.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/events/$slug/results/present" params={{ slug: event.slug }} />}
              nativeButton={false}
            >
              {t("results.present")}
            </Button>
          )}
        </>
      }
    >
      {results.awards.length > 0 && (
        <Screen.Section id="awards" title={t("results.awards")}>
          <ul className="flex flex-col gap-6">
            {results.awards.map((award) => (
              <li key={award.id}>
                <AwardCard award={award} highlight={award.teamId === myTeam} />
              </li>
            ))}
          </ul>
        </Screen.Section>
      )}
      {mine.length > 0 && (
        <Screen.Section id="your-team" title={t("results.yourTeam")}>
          <NoticeList>
            {mine.map((row) => {
              const notes = results.feedback.filter(
                (note) => note.submissionId === row.submissionId,
              );
              return (
                <Notice
                  key={row.submissionId}
                  title={t("results.rankTitle", { title: row.title, rank: row.rank })}
                  meta={t("results.rankMeta", { form: row.formTitle, score: row.score ?? "–" })}
                >
                  {notes.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {notes.map((note, index) => (
                        <Markdown key={index} className="typeset">
                          {note.body}
                        </Markdown>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-fg">{t("results.noNotes")}</p>
                  )}
                </Notice>
              );
            })}
          </NoticeList>
        </Screen.Section>
      )}

      {groups.map(({ title: formTitle, rows }) => (
        <Screen.Section
          key={formTitle}
          id={`ranking-${formTitle}`}
          title={groups.length > 1 ? formTitle : t("results.ranking")}
        >
          <RankedList
            label={t("results.rankingOf", { form: formTitle })}
            entries={rows.map((row) => ({
              key: row.submissionId,
              rank: row.rank,
              title: row.title,
              subtitle: row.teamName,
              value: row.score ?? "–",
              highlight: row.teamId === myTeam,
            }))}
          />
        </Screen.Section>
      ))}
    </Screen>
  );
}
