import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PreviewGate } from "#/components/app/PreviewGate.tsx";
import { isOrgAdmin } from "@bogey/db/auth";
import { orgAdmin } from "#/lib/viewer.ts";
import { msg } from "#/lib/translate.tsx";
import { OrgTabs } from "#/components/navigation/header/AreaTabs.tsx";

export const Route = createFileRoute("/_authed/org")({
  staticData: {
    title: msg("cmdGroup.Organization"),
    command: { group: "Organization", when: orgAdmin },
    header: {
      type: "nav",
      nav: OrgTabs,
    },
  },
  beforeLoad: ({ context }) => {
    if (!context.session.org || !isOrgAdmin(context.session)) {
      throw Route.redirect({ to: "/events", replace: true });
    }
    return { org: context.session.org };
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
