import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { can } from "@bogey/db/permissions";
import {
  announcementsTopic,
  eventAnnouncementsQueryOptions,
} from "@bogey/db/queries/announcements";
import {
  chatBlocksQueryOptions,
  eventConversationsQueryOptions,
  type Conversation,
} from "@bogey/db/queries/messages";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { IconBan } from "@tabler/icons-react";
import { useLiveBroadcast, useLiveInvalidate } from "@bogey/db/realtime";
import { Screen } from "@bogey/ui/components/screen";
import { ANNOUNCEMENTS, AnnouncementChannel } from "#/components/event/messaging/announcements.tsx";
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
      context.query.query({
        ...eventAnnouncementsQueryOptions(context.event.id, context.manager ? "all" : "published"),
        staleTime: "static",
      }),
      chats(context)
        ? context.query.query({
            ...eventConversationsQueryOptions(context.event.id),
            staleTime: "static",
          })
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
  // a conversation started elsewhere (e.g. "Ask about this") may be newer than the cached list
  const refetched = useRef<string | null>(null);
  const { data: listed, isFetching, refetch } = conversations;
  useEffect(() => {
    if (!c || c === ANNOUNCEMENTS || !listed || isFetching || refetched.current === c) return;
    if (listed.some((conversation) => conversation.id === c)) return;
    refetched.current = c;
    void refetch();
  }, [c, listed, isFetching, refetch]);

  const judge = !manages && access.role === "judge";
  const participant = access.role === "participant" && realAccess.role === "participant";
  const blocks = useQuery({ ...chatBlocksQueryOptions(event.id), enabled: participant });
  const block = participant ? blocks.data?.[0] : undefined;
  const visible = visibleConversations(access, conversations.data ?? []);
  const start = block
    ? []
    : offeredStarts(access, chat).filter((audience) => mayStart(realAccess, chat, audience));
  const canReply = (conversation: Conversation) =>
    !block && offeredReply(access, chat, conversation) && mayReply(realAccess, chat, conversation);
  const moderate = manages && can(realAccess, "event.manage");
  const forward = moderate;
  const posts = mayAnnounce(access, announcing) && mayAnnounce(realAccess, announcing);
  const messageTeams = mayMessageTeams(access, chat) && mayMessageTeams(realAccess, chat);

  return (
    <Screen title={t("messages.title")} description={t("messages.intro")} width="wide">
      {block && (
        <Alert variant="destructive">
          <IconBan />
          <AlertTitle>{t("conv.blocked")}</AlertTitle>
          <AlertDescription>
            {block.reason
              ? t("conv.blockedReason", { reason: block.reason })
              : t("conv.blockedBody")}
          </AlertDescription>
        </Alert>
      )}
      <Conversations
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
