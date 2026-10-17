import { createFileRoute, notFound } from "@tanstack/react-router";
import { instanceOrgsQueryOptions } from "@bogey/db/queries/instance";

export const Route = createFileRoute("/_authed/admin/orgs/$slug")({
  loader: async ({ context, params }) => {
    const orgs = await context.query.ensureQueryData(instanceOrgsQueryOptions());
    const org = orgs.find((each) => each.slug === params.slug);
    if (!org) throw notFound();
    return { org, title: org.name };
  },
});
