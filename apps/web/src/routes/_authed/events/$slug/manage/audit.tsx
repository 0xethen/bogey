import { createFileRoute, Link } from "@tanstack/react-router";
import { IconDownload } from "@tabler/icons-react";
import { auditLogQueryOptions } from "@bogey/db/queries/audit";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { AuditLog, auditSearchSchema } from "#/components/audit/audit-log.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { exportHref } from "#/lib/exports.ts";
import { msg, useT } from "#/lib/translate.tsx";

const searchSchema = auditSearchSchema.omit({ event: true });

export const Route = createFileRoute("/_authed/events/$slug/manage/audit")({
  staticData: {
    title: msg("orgTab.audit"),
    settings: (t) => [
      searchSection(t("orgTab.audit"), { id: "audit", keywords: ["history", "log", "changes"] }),
    ],
  },
  validateSearch: searchSchema,
  beforeLoad: ({ context, params }) => {
    if (!context.access.orgAdmin) {
      throw Route.redirect({ to: "/events/$slug/manage", params, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.query.ensureInfiniteQueryData(
      auditLogQueryOptions(context.event.org_id, { ...deps, event: context.event.id }),
    ),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton layout="table" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const filter = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Screen
      width="embedded"
      title={t("orgTab.audit")}
      description={
        <>
          {t("audit.eventIntro")}{" "}
          <Link to="/org/audit" className="link">
            {t("audit.seeAll")}
          </Link>
        </>
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={exportHref(event.slug, "audit")} download />}
        >
          <IconDownload />
          {t("audit.exportEvent")}
        </Button>
      }
    >
      <AuditLog
        orgId={event.org_id}
        eventId={event.id}
        filter={filter}
        onFilterChange={(next) => void navigate({ search: next, replace: true })}
      />
    </Screen>
  );
}
