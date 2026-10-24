import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import { webhooksQueryOptions, webhookDeliveriesQueryOptions } from "@bogey/db/queries/webhooks";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { Webhooks } from "#/components/settings/sections/webhooks.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/settings/webhooks")({
  staticData: {
    title: msg("webhooks.title"),
    settings: (t) => [
      searchSection(t("webhooks.title"), {
        id: "webhooks",
        keywords: ["api", "integrations", "http"],
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...webhooksQueryOptions({ orgId: context.org.id }),
        staleTime: "static",
      }),
      context.query.query({
        ...webhookDeliveriesQueryOptions({ orgId: context.org.id }),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  return <Webhooks scope={{ orgId: org.id }} title={t("webhooks.title")} />;
}
