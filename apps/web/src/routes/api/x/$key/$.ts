import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { pluginApiResponse } from "#/lib/server/plugin-api.server.ts";

const handle = ({
  request,
  params,
}: {
  request: Request;
  params: { key: string; _splat?: string };
}) => pluginApiResponse(request, params.key, params._splat ?? "");

export const Route = createFileRoute("/api/x/$key/$")({
  server: {
    handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle },
  },
});
