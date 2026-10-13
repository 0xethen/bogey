import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient } from "@bogey/db/admin";

export const Route = createFileRoute("/api/tls/ask")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const domain = new URL(request.url).searchParams.get("domain")?.trim().toLowerCase();
        if (!domain) return new Response("domain is required", { status: 400 });
        const { data, error } = await createAdminClient()
          .from("org_domains")
          .select("hostname")
          .eq("hostname", domain)
          .not("verified_at", "is", null)
          .maybeSingle();
        if (error) return new Response("lookup failed", { status: 500 });
        return data ? new Response("ok") : new Response("unknown domain", { status: 404 });
      },
    },
  },
});
