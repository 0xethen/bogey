import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/org/")({
  staticData: { command: false },
  beforeLoad: () => {
    throw Route.redirect({ to: "/org/members", replace: true });
  },
});
