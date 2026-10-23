import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { removeStorageOrphans } from "@bogey/db/storage-orphans";
import { drainSecret, verifyDrainSignature } from "#/lib/server/email-outbox.server.ts";

// pg_cron (private.sweep_storage_orphans) calls this, signed like the email drain
export const Route = createFileRoute("/api/storage/sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!verifyDrainSignature(request.headers, await drainSecret())) {
            return new Response("bad signature", { status: 401 });
          }
          return Response.json({ removed: await removeStorageOrphans() });
        } catch (error) {
          console.error("[bogey] storage sweep:", error instanceof Error ? error.message : error);
          return new Response("sweep failed", { status: 500 });
        }
      },
    },
  },
});
