import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getEvent, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getEvent(request, params.slug),
    },
  },
});
