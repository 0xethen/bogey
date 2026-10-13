import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import { webhooksQueryOptions, webhookDeliveriesQueryOptions } from "@bogey/db/queries/webhooks";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { Webhooks } from "#/components/settings/sections/webhooks.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/webhooks")({
  staticData: {
    title: msg("webhooks.title"),
    settings: (t) => [
      searchSection(t("webhooks.title"), {
        id: "webhooks",
        keywords: ["api", "integrations", "http"],
      }),
    ],
  },
  loader: ({ context }) => {
    const scope = { orgId: context.event.org_id, eventId: context.event.id };
    return Promise.all([
      context.query.ensureQueryData(webhooksQueryOptions(scope)),
      context.query.ensureQueryData(webhookDeliveriesQueryOptions(scope)),
    ]);
  },
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  return (
    <Webhooks scope={{ orgId: event.org_id, eventId: event.id }} title={t("webhooks.eventTitle")} />
  );
}
