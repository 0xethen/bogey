import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/events/$slug/announcements")({
  staticData: { command: false },
  beforeLoad: ({ params }) => {
    throw Route.redirect({
      to: "/events/$slug/messages",
      params,
      search: { c: "announcements" },
      replace: true,
    });
  },
});
