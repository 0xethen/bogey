import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/events")({
  staticData: { title: "Events" },
});
