import { createFileRoute, Outlet } from "@tanstack/react-router";
import { can, useCan } from "@bogey/db/permissions";
import { PreviewGate } from "#/components/app/PreviewGate.tsx";
import { PendingBanner } from "./-components/pending-banner.tsx";
import { inEvent, judgesOnly } from "#/lib/viewer.ts";
import { msg } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/judging")({
  staticData: { title: msg("judging.title"), command: { when: inEvent(judgesOnly) } },
  beforeLoad: ({ context, params }) => {
    if (!can(context.access, "judging.score")) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { event } = Route.useRouteContext();
  return (
    <PreviewGate allowed={useCan("judging.score")}>
      <PendingBanner eventId={event.id} />
      <Outlet />
    </PreviewGate>
  );
}
