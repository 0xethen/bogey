import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

const PAGES = ["types", "windows", "attendance"];

// Old paths (/agenda-types and so on), kept so bookmarks and links still work.
export const Route = createFileRoute("/_authed/events/$slug/manage/agenda-$page")({
  beforeLoad: ({ params, location }) => {
    if (!PAGES.includes(params.page)) throw notFound();
    const hash = location.hash ? `#${location.hash}` : "";
    throw redirect({
      href: `/events/${params.slug}/manage/agenda/${params.page === "windows" ? "" : params.page}${location.searchStr}${hash}`,
      replace: true,
    });
  },
});
