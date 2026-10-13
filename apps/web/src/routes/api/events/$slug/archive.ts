import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { archiveResponse } from "#/lib/server/archive.server.ts";

export const Route = createFileRoute("/api/events/$slug/archive")({
  server: {
    handlers: {
      GET: ({ params }) => archiveResponse(params.slug),
    },
  },
});
