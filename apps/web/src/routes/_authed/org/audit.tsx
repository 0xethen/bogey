import { IconDownload } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import { exportHref } from "#/lib/exports.ts";
import { createFileRoute } from "@tanstack/react-router";
import { auditLogQueryOptions } from "@bogey/db/queries/audit";
import { Screen } from "@bogey/ui/components/screen";
import { AuditLog, auditSearchSchema } from "#/components/audit/audit-log.tsx";
import { useQuery } from "@tanstack/react-query";
import { eventsQueryOptions } from "@bogey/db/queries/events";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/audit")({
  staticData: { title: msg("orgTab.audit") },
  validateSearch: auditSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.query.ensureInfiniteQueryData(auditLogQueryOptions(context.org.id, deps)),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton layout="table" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const filter = Route.useSearch();
  const navigate = Route.useNavigate();

  const events = useQuery(eventsQueryOptions(org.id));
  const filteredEvent = events.data?.find((event) => event.id === filter.event);

  return (
    <Screen
      width="wide"
      title={t("orgTab.audit")}
      description={t("audit.intro")}
      actions={
        filteredEvent && (
          <Button
            size="sm"
            variant="outline"
            render={<a href={exportHref(filteredEvent.slug, "audit")} download />}
            nativeButton={false}
          >
            <IconDownload />
            {t("audit.export", { event: filteredEvent.name })}
          </Button>
        )
      }
    >
      <AuditLog
        orgId={org.id}
        filter={filter}
        onFilterChange={(next) => void navigate({ search: next, replace: true })}
      />
    </Screen>
  );
}
