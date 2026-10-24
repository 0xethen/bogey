import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into Sessions.
export const Route = createFileRoute("/_authed/events/$slug/manage/agenda/types")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/events/$slug/manage/agenda/sessions",
      params,
      hash: "session-types",
      search: location.search as never,
      replace: true,
    });
  },
});
