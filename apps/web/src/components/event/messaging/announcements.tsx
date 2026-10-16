import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import {
  deleteAnnouncementFn,
  markAnnouncementsReadFn,
  type Announcement,
} from "@bogey/db/queries/announcements";
import { unwrap } from "@bogey/db/errors";
import { formatDateTime } from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DialogTrigger } from "@bogey/ui/components/dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { newAnnouncement } from "./announcement-composer.tsx";
import { ChatFeed, ChatMessage } from "./chat.tsx";
import { MessageAttachments } from "./message-attachments.tsx";
import { useT } from "#/lib/translate.tsx";

export const ANNOUNCEMENTS = "announcements";

export function AnnouncementMessage({
  announcement,
  meta,
  sideActions,
}: {
  announcement: Announcement;
  meta?: ReactNode;
  sideActions?: ReactNode;
}) {
  const t = useT();
  return (
    <ChatMessage
      authorName={announcement.authorName ?? t("announcements.organizers")}
      avatarInHeader
      at={announcement.publish_at}
      tone={announcement.severity}
      title={announcement.title}
      meta={meta}
      sideActions={sideActions}
      attachments={
        announcement.attachments.length > 0 && (
          <MessageAttachments attachments={announcement.attachments} />
        )
      }
    >
      {announcement.body_md}
    </ChatMessage>
  );
}

export function AnnouncementChannel({
  eventId,
  announcements,
  manage = false,
  post,
}: {
  eventId: string;
  announcements: Tuple<Announcement>;
  manage?: boolean;
  /** Set when the viewer may post; `anonymous` is the default for organizers. */
  post?: { anonymous: boolean };
}) {
  const t = useT();
  const time = useTimeFormat();
  const ref = useRef<HTMLDivElement>(null);
  const fresh = useMarkRead(eventId, announcements, ref);
  const ordered = announcements.toReversed();
  const firstNew = ordered.find((announcement) => fresh.has(announcement.id))?.id;
  const remove = useDeleteAnnouncement(eventId);

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <ErrorAlert error={remove.error} title={t("announcements.deleteFailed")} />
      {ordered.length === 0 ? (
        <p className="m-auto p-4 text-sm text-muted-fg">
          {manage ? t("announcements.emptyManage") : t("announcements.empty")}
        </p>
      ) : (
        <ChatFeed
          label={t("announcements.title")}
          items={ordered}
          at={(announcement) => announcement.publish_at}
          firstNew={firstNew}
        >
          {(announcement) => (
            <AnnouncementMessage
              announcement={announcement}
              meta={
                manage && (
                  <>
                    {announcement.scheduled && (
                      <Badge variant="outline">
                        {t("announcements.posts", {
                          when: formatDateTime(announcement.publish_at, time),
                        })}
                      </Badge>
                    )}
                    {!announcement.everyone &&
                      announcement.audience.map((target) => (
                        <Badge
                          key={target.kind === "role" ? target.role : target.id}
                          variant="secondary"
                        >
                          {target.label}
                        </Badge>
                      ))}
                  </>
                )
              }
              sideActions={
                manage && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={t("announcements.delete")}
                    title={t("announcements.delete")}
                    disabled={remove.isPending}
                    confirm={{
                      title: t("announcements.deleteTitle"),
                      description: t("announcements.deleteBody"),
                      label: t("common.delete"),
                    }}
                    onClick={() => remove.mutate(announcement.id)}
                  >
                    <IconTrash />
                  </Button>
                )
              }
            />
          )}
        </ChatFeed>
      )}
      {post && <AnnouncementBox />}
    </div>
  );
}

/** Announcements are composed in the New announcement dialog, not an inline box. */
function AnnouncementBox() {
  const t = useT();
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <p className="text-sm text-muted-fg">{t("announcements.boxHelp")}</p>
      <DialogTrigger handle={newAnnouncement} render={<Button type="button" size="sm" />}>
        <IconSpeakerphone />
        {t("announcements.new")}
      </DialogTrigger>
    </div>
  );
}

function useDeleteAnnouncement(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await deleteAnnouncementFn({ data: id })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["announcements", eventId] }),
  });
}

function useMarkRead(
  eventId: string,
  announcements: Tuple<Announcement>,
  ref: RefObject<HTMLElement | null>,
): ReadonlySet<string> {
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const unread = announcements.filter((announcement) => !announcement.read).map((a) => a.id);
  const key = unread.join(",");

  const arrived = unread.filter((id) => !fresh.has(id));
  if (arrived.length) setFresh(new Set([...fresh, ...arrived]));

  useEffect(() => {
    if (!key || !ref.current?.checkVisibility()) return;
    const ids = key.split(",");
    void markAnnouncementsReadFn({ data: { ids } }).then((result) => {
      if (!result.ok) return;
      queryClient.setQueriesData<Announcement[]>({ queryKey: ["announcements", eventId] }, (list) =>
        list?.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)),
      );
    });
  }, [key, eventId, queryClient, ref]);

  return fresh;
}
