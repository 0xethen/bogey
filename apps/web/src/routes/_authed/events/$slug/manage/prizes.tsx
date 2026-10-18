import { createFileRoute } from "@tanstack/react-router";

// prizes are edited in Manage → Pages now; old links land on them there
export const Route = createFileRoute("/_authed/events/$slug/manage/prizes")({
  beforeLoad: ({ params }) => {
    throw Route.redirect({
      to: "/events/$slug/manage/pages",
      params,
      hash: "prizes",
      replace: true,
    });
  },
});
