import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getGallery, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/gallery")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getGallery(request, params.slug),
    },
  },
});
