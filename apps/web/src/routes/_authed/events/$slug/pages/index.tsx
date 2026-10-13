import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/events/$slug/pages/")({
  beforeLoad: ({ params }) => {
    throw Route.redirect({ to: "/events/$slug", params, replace: true });
  },
});
