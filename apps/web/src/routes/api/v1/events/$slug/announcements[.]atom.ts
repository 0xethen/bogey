import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getAnnouncementsFeed, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/announcements.atom")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getAnnouncementsFeed(request, params.slug, "atom"),
    },
  },
});
