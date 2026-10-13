import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import {
  drainOutbox,
  drainSecret,
  verifyDrainSignature,
} from "#/lib/server/email-outbox.server.ts";

export const Route = createFileRoute("/api/email/drain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!verifyDrainSignature(request.headers, await drainSecret())) {
            return new Response("bad signature", { status: 401 });
          }
          return Response.json(await drainOutbox());
        } catch (error) {
          console.error("[bogey] email drain:", error instanceof Error ? error.message : error);
          return new Response("drain failed", { status: 500 });
        }
      },
    },
  },
});
