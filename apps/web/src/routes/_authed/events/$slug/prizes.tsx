import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { IconTrophy } from "@tabler/icons-react";
import { eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { Screen } from "@bogey/ui/components/screen";
import { PrizeCard, usePrizeImage } from "#/components/event/judging/prize-card.tsx";
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
  const image = usePrizeImage(event.id);
  return (
    <Screen
      title={t("prizes.title")}
      description={t("prizes.intro", { event: event.name })}
      width="narrow"
    >
      {prizes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconTrophy />
            </EmptyMedia>
            <EmptyTitle>{t("prizes.noneTitle")}</EmptyTitle>
            <EmptyDescription>{t("prizes.none")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-8">
          {prizes.map((prize) => (
            <li key={prize.id}>
              <PrizeCard prize={prize} image={image} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
