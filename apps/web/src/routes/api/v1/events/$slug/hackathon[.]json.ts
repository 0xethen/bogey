import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getHackathonJson, preflight } from "#/lib/server/api-v1.server.ts";

export const Route = createFileRoute("/api/v1/events/$slug/hackathon.json")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: ({ request, params }) => getHackathonJson(request, params.slug),
    },
  },
});
