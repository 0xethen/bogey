import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { IconPrinter } from "@tabler/icons-react";
import { tableListQueryOptions } from "@bogey/db/queries/expo";
import { can, useCan } from "@bogey/db/permissions";
import { PreviewGate } from "#/components/app/PreviewGate.tsx";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/tables")({
  staticData: { title: msg("tables.title"), command: false },
  beforeLoad: ({ context, params }) => {
    if (!can(context.access, "event.manage")) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
  },
  loader: ({ context }) => context.query.ensureQueryData(tableListQueryOptions(context.event.id)),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <PreviewGate allowed={useCan("event.manage")}>
      <Tables />
    </PreviewGate>
  );
}

function Tables() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: rows } = useSuspenseQuery(tableListQueryOptions(event.id));
  const numbered = rows.filter((row) => row.table);

  return (
    <Screen
      title={t("tables.title")}
      description={t("tables.intro", { event: event.name })}
      width="narrow"
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            render={
              <Link
                to="/events/$slug/manage/judging/demos"
                hash="expo-tables"
                params={{ slug: event.slug }}
              />
            }
            nativeButton={false}
          >
            {t("common.back")}
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <IconPrinter />
            {t("common.print")}...
          </Button>
        </>
      }
    >
      <div data-print-area className="flex flex-col gap-4 p-4">
        <h2 className="font-heading text-2xl font-semibold">
          {t("tables.heading", { event: event.name })}
        </h2>
        {numbered.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("tables.none")}</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">{t("tables.table")}</th>
                <th className="py-2 pr-4 font-medium">{t("tables.project")}</th>
                <th className="py-2 pr-4 font-medium">{t("tables.team")}</th>
                <th className="py-2 font-medium">{t("tables.division")}</th>
              </tr>
            </thead>
            <tbody>
              {numbered.map((row) => (
                <tr key={row.submissionId} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-semibold">{row.table}</td>
                  <td className="py-2 pr-4">{row.title}</td>
                  <td className="py-2 pr-4">{row.teamName}</td>
                  <td className="py-2">{row.divisionName ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Screen>
  );
}
