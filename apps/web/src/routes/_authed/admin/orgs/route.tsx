import { createFileRoute } from "@tanstack/react-router";
import { msg } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/orgs")({
  staticData: { title: msg("adminTab.orgs") },
});
