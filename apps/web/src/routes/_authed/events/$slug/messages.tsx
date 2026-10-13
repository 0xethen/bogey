import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { can } from "@bogey/db/permissions";
import {
  announcementsTopic,
  eventAnnouncementsQueryOptions,
} from "@bogey/db/queries/announcements";
import { eventConversationsQueryOptions, type Conversation } from "@bogey/db/queries/messages";
import { useLiveBroadcast, useLiveInvalidate } from "@bogey/db/realtime";
import { Screen } from "@bogey/ui/components/screen";
import { AnnouncementChannel } from "#/components/event/messaging/announcements.tsx";
import {
  Conversations,
  messagesSearch,
} from "#/routes/_authed/events/$slug/-components/conversations.tsx";
import {
  mayAnnounce,
  mayMessageTeams,
  mayReply,
  mayStart,
  offeredReply,
  offeredStarts,
  visibleConversations,
} from "#/lib/messaging.ts";
import { chats, useEventViewer } from "#/lib/viewer.ts";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/messages")({
  staticData: { title: msg("messages.title") },
  validateSearch: messagesSearch,
  beforeLoad: ({ context }) => ({ manager: can(context.access, "event.manage") }),
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(
        eventAnnouncementsQueryOptions(context.event.id, context.manager ? "all" : "published"),
      ),
      chats(context)
        ? context.query.ensureQueryData(eventConversationsQueryOptions(context.event.id))
        : null,
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="wide" />,
});

function RouteComponent() {
  const t = useT();
  const {
    event,
    access: realAccess,
    chat,
    manager,
    session,
    announcements: announcing,
  } = Route.useRouteContext();
  const { c } = Route.useSearch();
  const navigate = Route.useNavigate();
  const access = useEventViewer()?.access ?? realAccess;
  const manages = can(access, "event.manage");
  const chatting = chats({ access, chat });

  const announcementOptions = eventAnnouncementsQueryOptions(
    event.id,
    manager ? "all" : "published",
  );
  const { data: loaded } = useSuspenseQuery(announcementOptions);
  useLiveInvalidate("announcements", announcementOptions.queryKey, {
    filter: `event_id=eq.${event.id}`,
  });
  useLiveBroadcast(announcementsTopic(event.id), announcementOptions.queryKey);
  const announcements = manages ? loaded : loaded.filter((announcement) => !announcement.scheduled);
  const posted = announcements.filter((announcement) => !announcement.scheduled);

  const options = eventConversationsQueryOptions(event.id);
  const conversations = useQuery({ ...options, enabled: chats({ access: realAccess, chat }) });
  useLiveInvalidate("clarifications", options.queryKey, { filter: `event_id=eq.${event.id}` });
  useLiveInvalidate("clarification_messages", options.queryKey, {
    filter: `event_id=eq.${event.id}`,
  });

  const judge = !manages && access.role === "judge";
  const visible = visibleConversations(access, conversations.data ?? []);
  const start = offeredStarts(access, chat).filter((audience) =>
    mayStart(realAccess, chat, audience),
  );
  const canReply = (conversation: Conversation) =>
    offeredReply(access, chat, conversation) && mayReply(realAccess, chat, conversation);
  const moderate = manages && can(realAccess, "event.manage");
  const forward = moderate;
  const posts = mayAnnounce(access, announcing) && mayAnnounce(realAccess, announcing);
  const messageTeams = mayMessageTeams(access, chat) && mayMessageTeams(realAccess, chat);

  return (
    <Screen title={t("messages.title")} width="wide">
      <Conversations
        eventId={event.id}
        viewerId={session.user.id}
        conversations={chatting ? visible : undefined}
        announcements={{
          channel: (
            <AnnouncementChannel
              eventId={event.id}
              announcements={announcements}
              manage={moderate}
              post={
                posts ? { anonymous: manages && announcing.postAs === "organizers" } : undefined
              }
            />
          ),
          latest: posted[0],
          unread: posted.filter((announcement) => !announcement.read).length,
        }}
        openId={c}
        onOpen={(id) => void navigate({ search: { c: id }, replace: true })}
        start={start}
        messageTeams={messageTeams}
        canReply={canReply}
        moderate={moderate}
        forward={forward}
        empty={manages || judge ? t("messages.emptyStaff") : t("messages.emptyParticipant")}
      />
    </Screen>
  );
}
