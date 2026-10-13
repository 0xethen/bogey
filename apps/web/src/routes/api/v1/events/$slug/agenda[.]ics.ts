import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getAgendaIcs, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/agenda.ics")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getAgendaIcs(request, params.slug),
    },
  },
});
