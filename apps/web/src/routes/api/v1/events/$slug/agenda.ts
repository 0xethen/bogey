import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getAgenda, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/agenda")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getAgenda(request, params.slug),
    },
  },
});
