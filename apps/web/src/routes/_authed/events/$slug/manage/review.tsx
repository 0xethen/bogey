import { createFileRoute, redirect } from "@tanstack/react-router";

// Old path, kept so bookmarks and links still work.
export const Route = createFileRoute("/_authed/events/$slug/manage/review")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/events/$slug/manage/people/review",
      params,
      search: location.search as never,
      hash: location.hash || undefined,
      replace: true,
    });
  },
});
