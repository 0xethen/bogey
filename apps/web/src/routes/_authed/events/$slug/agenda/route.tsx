import { createFileRoute, Outlet } from "@tanstack/react-router";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import { msg } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/agenda")({
  staticData: { title: msg("eventTab.agenda") },
  loader: ({ context }) =>
    context.query.query({ ...agendaQueryOptions(context.event.id), staleTime: "static" }),
  component: Outlet,
});
