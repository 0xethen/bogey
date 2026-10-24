import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconPrinter } from "@tabler/icons-react";
import { badgeSheetQueryOptions } from "@bogey/db/queries/checkin";
import { can, useCan } from "@bogey/db/permissions";
import { PreviewGate } from "#/components/app/PreviewGate.tsx";
import { Button } from "@bogey/ui/components/button";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import { QrCode } from "#/components/event/qr-code.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/badges")({
  staticData: { title: msg("badges.title"), command: false },
  validateSearch: z.object({
    layout: z.enum(["sheet", "big"]).optional().catch(undefined),
    roles: z.enum(["participant", "all"]).optional().catch(undefined),
  }),
  beforeLoad: ({ context, params }) => {
    if (!can(context.access, "people.checkin")) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
  },
  loader: ({ context }) =>
    context.query.query({ ...badgeSheetQueryOptions(context.event.id), staleTime: "static" }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <PreviewGate allowed={useCan("people.checkin")}>
      <Badges />
    </PreviewGate>
  );
}

function Badges() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { layout = "sheet", roles = "participant" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: all } = useSuspenseQuery(badgeSheetQueryOptions(event.id));
  const badges = roles === "all" ? all : all.filter((badge) => badge.role === "participant");

  return (
    <Screen
      title={t("badges.title")}
      description={t("badges.toPrint", { count: badges.length, event: event.name })}
      width="wide"
      actions={
        <>
          <OptSelect
            id="badge-layout"
            value={layout}
            onChange={(next) => void navigate({ search: (old) => ({ ...old, layout: next }) })}
            options={[
              { value: "sheet", label: t("badges.sheet") },
              { value: "big", label: t("badges.big") },
            ]}
          />
          <OptSelect
            id="badge-roles"
            value={roles}
            onChange={(next) => void navigate({ search: (old) => ({ ...old, roles: next }) })}
            options={[
              { value: "participant", label: t("badges.participants") },
              { value: "all", label: t("badges.everyone") },
            ]}
          />
          <Button
            size="sm"
            variant="ghost"
            render={<Link to="/events/$slug/manage/people" params={{ slug: event.slug }} />}
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
      <style>{"@media print { @page { size: letter; margin: 0.5in; } }"}</style>
      <div
        data-print-area
        className={
          layout === "sheet"
            ? "grid grid-cols-2 justify-items-center gap-4 print:gap-0"
            : "flex flex-col items-center gap-8 print:gap-0"
        }
      >
        {badges.map((badge) => (
          <div
            key={badge.userId}
            className={
              layout === "sheet"
                ? "flex h-[3in] w-[4in] break-inside-avoid items-center gap-4 border border-dashed border-border p-4"
                : "flex min-h-[9in] w-full break-after-page flex-col items-center justify-center gap-6 text-center"
            }
          >
            <QrCode
              value={badge.code}
              size={layout === "sheet" ? 112 : 320}
              label={t("badges.codeFor", { name: badge.name })}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p
                className={
                  layout === "sheet"
                    ? "font-heading text-xl leading-tight font-bold"
                    : "font-heading text-5xl font-bold"
                }
              >
                {badge.name}
              </p>
              <p className={layout === "sheet" ? "text-sm" : "text-2xl"}>
                {[badge.team, badge.division].filter(Boolean).join(" · ")}
              </p>
              {badge.role !== "participant" && (
                <p className="text-sm font-semibold uppercase tracking-wide">{badge.role}</p>
              )}
              <p className="font-mono text-sm tracking-widest">{badge.code}</p>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}
