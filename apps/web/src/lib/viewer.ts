import { useMatch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@bogey/db/auth";
import { isOrgAdmin, sessionQueryOptions } from "@bogey/db/auth";
import { can, previewAccess, useViewAs, type EventAccess } from "@bogey/db/permissions";
import type { Event } from "@bogey/db/queries/events";
import { windowByKey, type EventWindow } from "@bogey/db/queries/windows";
import type { PluginManifest } from "@bogey/plugins";
import type { ResolvedValue } from "@bogey/config/settings";
import { isSubmissionWindow } from "#/lib/windows.ts";

export interface EventViewer {
  event: Event;
  access: EventAccess;
  windows: Tuple<EventWindow>;
  plugins: Tuple<PluginManifest>;
  pluginSettings: Record<string, Record<string, unknown>>;
  hasAgenda: boolean;
  chat: ResolvedValue<"chat">;
  /** The event's own words before the submission countdown, if it set any. */
  countdownLabel: string | null;
}

export interface Viewer {
  session: Session;
  event?: EventViewer;
}

export const manages = ({ access }: EventViewer) => can(access, "event.manage");
export const participates = ({ access }: EventViewer) => access.role === "participant";
export const hasTeamPage = (viewer: EventViewer) =>
  participates(viewer) && viewer.event.team_size_max > 1;
export const hasSubmissionPage = (viewer: EventViewer) =>
  participates(viewer) && viewer.windows.some((window) => isSubmissionWindow(window.key));
export const judgesOnly = (viewer: EventViewer) =>
  can(viewer.access, "judging.score") && !manages(viewer);
export const atTheDesk = ({ access }: EventViewer) => can(access, "people.checkin");
export const hasAgenda = (viewer: EventViewer) => viewer.hasAgenda;
export const hasResults = ({ windows }: EventViewer) => !!windowByKey(windows, "results");
export const chats = ({ access, chat }: Pick<EventViewer, "access" | "chat">) =>
  chat.enabled &&
  (can(access, "event.manage") ||
    (access.role === "judge" && (chat.staff || chat.judges)) ||
    (access.role === "participant" && chat.participants));
export const canRegister = ({ access }: EventViewer) => !access.role && !access.orgAdmin;

export function inEvent(check: (viewer: EventViewer) => boolean) {
  return ({ event }: Viewer) => event !== undefined && check(event);
}

export const orgAdmin = ({ session }: Viewer) => isOrgAdmin(session) && !!session.org;
export const platformAdmin = ({ session }: Viewer) => session.platformAdmin;

export function useEventViewer(): EventViewer | undefined {
  const context = useMatch({
    from: "/_authed/events/$slug",
    shouldThrow: false,
    select: (match) => (match.status === "success" ? match.context : undefined),
  });
  const previewing = useViewAs();
  if (!context) return undefined;
  return {
    event: context.event,
    access: previewAccess(context.access, previewing),
    windows: context.windows,
    plugins: context.plugins,
    pluginSettings: context.pluginSettings,
    hasAgenda: context.hasAgenda,
    chat: context.chat,
    countdownLabel: context.countdownLabel,
  };
}

export function useSession(): Session | undefined {
  const { data } = useQuery(sessionQueryOptions());
  return data?.status === "authenticated" ? data.session : undefined;
}

export function previewSession(session: Session, previewing: string | null): Session {
  if (!previewing) return session;
  return { ...session, platformAdmin: false, orgRole: session.orgRole ? "member" : null };
}

export function useViewerSession(): Session | undefined {
  const session = useSession();
  const previewing = useViewAs();
  return session ? previewSession(session, previewing) : undefined;
}

export function useRealEventAccess(): { event: Event; access: EventAccess } | undefined {
  return useMatch({
    from: "/_authed/events/$slug",
    shouldThrow: false,
    select: (match) =>
      match.status === "success"
        ? { event: match.context.event, access: match.context.access }
        : undefined,
  });
}

export function useCanPreview(): boolean {
  const real = useRealEventAccess();
  return !!real && can(real.access, "event.manage");
}
