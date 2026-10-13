import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { listEvents, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request }) => listEvents(request),
    },
  },
});
