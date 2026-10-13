import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { Screen } from "@bogey/ui/components/screen";
import { PrizeCard } from "#/components/event/judging/prize-card.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/prizes")({
  staticData: { title: msg("prizes.title") },
  loader: ({ context }) => context.query.ensureQueryData(eventPrizesQueryOptions(context.event.id)),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: prizes } = useSuspenseQuery(eventPrizesQueryOptions(event.id));
  return (
    <Screen
      title={t("prizes.title")}
      description={t("prizes.intro", { event: event.name })}
      width="narrow"
    >
      {prizes.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("prizes.none")}</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {prizes.map((prize) => (
            <li key={prize.id}>
              <PrizeCard prize={prize} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
