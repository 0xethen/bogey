import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { eventPagesQueryOptions } from "@bogey/db/queries/pages";
import { Markdown } from "@bogey/ui/components/markdown";
import { Screen } from "@bogey/ui/components/screen";
import { msg } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/pages/$page")({
  staticData: { title: msg("page.title") },
  loader: async ({ context, params }) => {
    const pages = await context.query.query({
      ...eventPagesQueryOptions(context.event.id),
      staleTime: "static",
    });
    const page = pages.find((candidate) => candidate.slug === params.page);
    if (!page) throw notFound();
    return { title: page.title };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { event } = Route.useRouteContext();
  const params = Route.useParams();
  const { data: pages } = useSuspenseQuery(eventPagesQueryOptions(event.id));
  const page = pages.find((candidate) => candidate.slug === params.page);
  if (!page) return null;

  return (
    <Screen title={page.title} width="narrow">
      <Markdown>{page.body_md}</Markdown>
    </Screen>
  );
}
