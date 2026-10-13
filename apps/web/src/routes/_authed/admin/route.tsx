import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PreviewGate } from "#/components/app/PreviewGate.tsx";
import { platformAdmin } from "#/lib/viewer.ts";
import { msg } from "#/lib/translate.tsx";
import { AdminTabs } from "#/components/navigation/header/plugin-area-tabs.tsx";

export const Route = createFileRoute("/_authed/admin")({
  staticData: {
    title: msg("cmdGroup.Instance"),
    command: { group: "Instance", when: platformAdmin },
    header: {
      type: "nav",
      nav: AdminTabs,
    },
  },
  beforeLoad: ({ context }) => {
    if (context.session.adminNeedsMfa) {
      throw Route.redirect({ to: "/account/security", search: { mfa: "admin" }, replace: true });
    }
    if (!context.session.platformAdmin) throw Route.redirect({ to: "/events", replace: true });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <PreviewGate>
      <Outlet />
    </PreviewGate>
  );
}
