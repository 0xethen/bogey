import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/")({
  beforeLoad: ({ context }) => {
    throw Route.redirect({
      to: context.session.platformAdmin ? "/admin" : "/events",
      replace: true,
    });
  },
});
