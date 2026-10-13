import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/org/events")({
  staticData: { command: false },
  beforeLoad: () => {
    throw Route.redirect({ to: "/events" });
  },
});
