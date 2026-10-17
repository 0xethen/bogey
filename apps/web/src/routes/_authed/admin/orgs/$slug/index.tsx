import { createFileRoute } from "@tanstack/react-router";

// an org's details live in its row on the list
export const Route = createFileRoute("/_authed/admin/orgs/$slug/")({
  beforeLoad: () => {
    throw Route.redirect({ to: "/admin/orgs", replace: true });
  },
});
