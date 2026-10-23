import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  chatBlocksQueryOptions,
  eventConversationsQueryOptions,
  unblockFromChatFn,
} from "@bogey/db/queries/messages";
import { IconMessageQuestion } from "@tabler/icons-react";
import { LinkRow, Row, RowList } from "@bogey/ui/components/row";
import { unwrap } from "@bogey/db/errors";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

const CHAT_KEYS = ["enabled", "staff", "participants", "judges", "copyTeam"] as const;

export const Route = createFileRoute("/_authed/events/$slug/manage/messages")({
  staticData: {
    title: msg("eventTab.messages"),
    settings: (t) => [
      searchSection(t("messages.unanswered"), { id: "unanswered", keywords: ["waiting", "open"] }),
      searchSection(t("messages.who"), { id: "chat", keywords: ["chat", "questions"] }),
      ...searchSettings("chat", CHAT_KEYS, t),
      searchSection(t("messages.blocked"), { id: "blocked", keywords: ["block", "abuse", "spam"] }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, ["chat"]),
      context.query.ensureQueryData(chatBlocksQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventConversationsQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  return (
    <Screen
      title={t("eventTab.messages")}
      description={t("messages.manageIntro")}
      width="embedded"
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/events/$slug/messages" params={{ slug: event.slug }} />}
        >
          {t("messages.open")}
        </Button>
      }
    >
      <Unanswered eventId={event.id} slug={event.slug} />
      <Screen.Section id="chat" title={t("messages.who")}>
        <SettingFields scope={scope} namespace="chat" keys={CHAT_KEYS} />
      </Screen.Section>
      <Blocked eventId={event.id} />
      <PluginSettingSections page="messages" />
    </Screen>
  );
}

// the same threads the overview's "Needs you" counts, each opening where it's answered
function Unanswered({ eventId, slug }: { eventId: string; slug: string }) {
  const t = useT();
  const { data: threads } = useSuspenseQuery(eventConversationsQueryOptions(eventId));
  const open = threads.filter((thread) => thread.status === "open");
  return (
    <Screen.Section
      id="unanswered"
      title={t("messages.unanswered")}
      description={t("messages.unansweredHelp")}
    >
      {open.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("messages.noneUnanswered")}</p>
      ) : (
        <div className="flex flex-col">
          {open.map((thread) => (
            <LinkRow
              key={thread.id}
              render={
                <Link to="/events/$slug/messages" params={{ slug }} search={{ c: thread.id }} />
              }
              leading={<IconMessageQuestion className="size-5 text-warning" />}
              title={thread.subject}
              meta={
                <>
                  {thread.askerName} · <RelativeTime value={thread.updatedAt} />
                </>
              }
            />
          ))}
        </div>
      )}
    </Screen.Section>
  );
}

function Blocked({ eventId }: { eventId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: blocks } = useSuspenseQuery(chatBlocksQueryOptions(eventId));
  const unblock = useMutation({
    mutationFn: async (id: string) => unwrap(await unblockFromChatFn({ data: id })),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: chatBlocksQueryOptions(eventId).queryKey }),
  });
  return (
    <Screen.Section
      id="blocked"
      title={t("messages.blocked")}
      description={t("messages.blockedHelp")}
    >
      <ErrorAlert error={unblock.error} title={t("messages.unblockFailed")} />
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("messages.noneBlocked")}</p>
      ) : (
        <RowList render={<ul />}>
          {blocks.map((block) => (
            <Row
              key={block.id}
              render={<li />}
              title={block.name}
              meta={
                <>
                  {block.reason ? `${block.reason} · ` : ""}
                  <RelativeTime value={block.createdAt} />
                </>
              }
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unblock.isPending}
                  onClick={() => unblock.mutate(block.id)}
                >
                  {t("messages.unblock")}
                </Button>
              }
            />
          ))}
        </RowList>
      )}
    </Screen.Section>
  );
}
