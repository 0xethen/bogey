import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getResults, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/results")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getResults(request, params.slug),
    },
  },
});
