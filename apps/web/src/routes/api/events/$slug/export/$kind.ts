import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { exportResponse } from "#/lib/server/exports.server.ts";

export const Route = createFileRoute("/api/events/$slug/export/$kind")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        exportResponse(params.slug, params.kind, new URL(request.url).searchParams.get("form")),
    },
  },
});
