import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getPersonalCalendar, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/calendar/$token")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getPersonalCalendar(request, params.token),
    },
  },
});
