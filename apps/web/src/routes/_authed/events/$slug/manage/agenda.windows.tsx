import { createFileRoute, redirect } from "@tanstack/react-router";

// Windows is now the main Agenda page.
export const Route = createFileRoute("/_authed/events/$slug/manage/agenda/windows")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: `/events/${params.slug}/manage/agenda${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  },
});
