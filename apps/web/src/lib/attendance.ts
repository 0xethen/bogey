import { useCan } from "@bogey/db/permissions";
import type { AgendaSession } from "@bogey/db/queries/sessions";
import { useSession } from "#/lib/viewer.ts";

/** Whether the viewer takes a session's attendance: staff with the permission, or one of its hosts. */
export function useTakesAttendance(): (
  session: Pick<AgendaSession, "canTakeAttendance" | "hosts">,
) => boolean {
  const attendance = useCan("sessions.attendance");
  const me = useSession()?.user.id;
  return (session) =>
    session.canTakeAttendance && (attendance || session.hosts.some((host) => host.id === me));
}
