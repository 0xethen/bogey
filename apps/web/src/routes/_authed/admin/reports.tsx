import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  pageReportsQueryOptions,
  setReportHandledFn,
  type PageReport,
} from "@bogey/db/queries/instance";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@bogey/ui/components/empty";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/reports")({
  staticData: { title: msg("adminTab.reports"), command: { label: msg("adminTab.reports") } },
  loader: ({ context }) =>
    context.query.query({ ...pageReportsQueryOptions(true), staleTime: "static" }),
  component: RouteComponent,
});

const column = dataColumns<PageReport>();

const search = {
  text: (report: PageReport) =>
    `${report.orgName} ${report.path} ${report.reason} ${report.reporter ?? ""}`,
};

function RouteComponent() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: reports } = useSuspenseQuery(pageReportsQueryOptions(true));
  const close = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await setReportHandledFn({ data: { id, handled: true } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["instance", "reports"] }),
  });
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("orgName", { header: t("reports.organization"), enableHiding: false }),
        column.accessor("path", {
          header: t("reports.page"),
          cell: (info) => <code className="text-xs text-muted-fg">{info.getValue()}</code>,
        }),
        column.accessor("reason", {
          header: t("report.reason"),
          cell: (info) => <span className="whitespace-pre-wrap">{info.getValue()}</span>,
        }),
        column.accessor((report) => report.reporter ?? t("reports.anonymous"), {
          id: "reporter",
          header: t("reports.reporter"),
        }),
        column.accessor("createdAt", {
          header: t("audit.date"),
          cell: (info) => (
            <span className="text-muted-fg">
              <RelativeTime value={info.getValue()} />
            </span>
          ),
        }),
        column.display({
          id: "close",
          header: () => <span className="sr-only">{t("common.close")}</span>,
          enableHiding: false,
          cell: (info) => (
            <Button
              size="sm"
              variant="outline"
              disabled={close.isPending}
              onClick={() => close.mutate(info.row.original.id)}
            >
              {t("common.close")}
            </Button>
          ),
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, close.isPending],
  );

  return (
    <Screen
      title={t("adminTab.reports")}
      description={
        <>
          {t("reports.intro")}{" "}
          <Route.Link to="/admin/orgs" className="link">
            {t("reports.restrict")}...
          </Route.Link>
        </>
      }
      width="wide"
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
        <DataTable
          columns={columns}
          data={reports}
          getRowId={(report) => report.id}
          search={search}
          pageSize={25}
        />
      )}
    </Screen>
  );
}
