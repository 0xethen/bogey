import { createFileRoute, Outlet } from "@tanstack/react-router";
import { atTheDesk, inEvent } from "#/lib/viewer.ts";
import { msg } from "#/lib/translate.tsx";

// the desk (index) and each session's attendance ($sessionId) check their own permissions: a
// session's host takes its attendance without working the desk
export const Route = createFileRoute("/_authed/events/$slug/checkin")({
  staticData: { title: msg("checkin.title"), command: { when: inEvent(atTheDesk) } },
  component: Outlet,
});
