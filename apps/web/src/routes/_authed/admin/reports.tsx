import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { pageReportsQueryOptions, setReportHandledFn } from "@bogey/db/queries/instance";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@bogey/ui/components/empty";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@bogey/ui/components/item";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/reports")({
  staticData: { title: msg("adminTab.reports"), command: { label: msg("adminTab.reports") } },
  loader: ({ context }) => context.query.ensureQueryData(pageReportsQueryOptions(true)),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: reports } = useSuspenseQuery(pageReportsQueryOptions(true));
  const close = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await setReportHandledFn({ data: { id, handled: true } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["instance", "reports"] }),
  });

  return (
    <Screen
      title={t("adminTab.reports")}
      description={
        <>
          {t("reports.intro")}{" "}
          <Route.Link to="/admin/orgs" className="link">
            {t("reports.restrict")}
          </Route.Link>
        </>
      }
      width="narrow"
    >
      <ErrorAlert error={close.error} title={t("reports.failed")} />
      {reports.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("reports.none")}</EmptyTitle>
            <EmptyDescription>{t("reports.noneHelp")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li key={report.id}>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {report.orgName} <code className="text-xs text-muted-fg">{report.path}</code>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none whitespace-pre-wrap">
                    {report.reason}
                  </ItemDescription>
                  <ItemDescription>
                    {report.reporter ?? t("reports.anonymous")} ·{" "}
                    <RelativeTime value={report.createdAt} />
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={close.isPending}
                    onClick={() => close.mutate(report.id)}
                  >
                    {t("common.close")}
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
