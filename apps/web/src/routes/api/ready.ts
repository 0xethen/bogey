import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { readiness } from "#/lib/server/readiness.server.ts";

// /api/health only says the process is up (Docker's HEALTHCHECK); this one says whether
// people can use it: for uptime monitors and the event-day checks.
export const Route = createFileRoute("/api/ready")({
  server: {
    handlers: {
      GET: async () => {
        const report = await readiness();
        return Response.json(report, {
          status: report.ok ? 200 : 503,
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
