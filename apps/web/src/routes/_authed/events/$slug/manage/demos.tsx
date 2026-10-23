import { createFileRoute, redirect } from "@tanstack/react-router";

// Old path, kept so bookmarks and links still work.
export const Route = createFileRoute("/_authed/events/$slug/manage/demos")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/events/$slug/manage/judging/demos",
      params,
      search: location.search as never,
      hash: location.hash || undefined,
      replace: true,
    });
  },
});
