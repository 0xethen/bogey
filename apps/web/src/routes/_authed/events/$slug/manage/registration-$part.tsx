import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

// Old path (/registration-form), kept so bookmarks and links still work.
export const Route = createFileRoute("/_authed/events/$slug/manage/registration-$part")({
  beforeLoad: ({ params, location }) => {
    if (params.part !== "form") throw notFound();
    const hash = location.hash ? `#${location.hash}` : "";
    throw redirect({
      href: `/events/${params.slug}/manage/registration/form${location.searchStr}${hash}`,
      replace: true,
    });
  },
});
