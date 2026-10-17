import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { instanceOrgsQueryOptions } from "@bogey/db/queries/instance";
import { Screen } from "@bogey/ui/components/screen";
import { OrgLimits, orgLimitsQuery } from "../-components/org-limits.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/orgs/$slug/limits")({
  staticData: { title: msg("adminOrgs.limits") },
  loader: async ({ context, params }) => {
    const orgs = await context.query.ensureQueryData(instanceOrgsQueryOptions());
    const org = orgs.find((each) => each.slug === params.slug);
    if (org) await context.query.ensureQueryData(orgLimitsQuery(org.id));
  },
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton />,
});

function RouteComponent() {
  const t = useT();
  const { slug } = Route.useParams();
  const { data: orgs } = useSuspenseQuery(instanceOrgsQueryOptions());
  const org = orgs.find((each) => each.slug === slug);
  return (
    <Screen title={t("adminOrgs.limits")} description={t("orgLimit.intro")}>
      {org && <OrgLimits org={org} />}
    </Screen>
  );
}
