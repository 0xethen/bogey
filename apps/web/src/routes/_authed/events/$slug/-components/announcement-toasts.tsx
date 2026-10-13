import { useEffect, useRef } from "react";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  announcementsTopic,
  eventAnnouncementsQueryOptions,
} from "@bogey/db/queries/announcements";
import { useLiveBroadcast, useLiveInvalidate } from "@bogey/db/realtime";
import { emitSignal } from "@bogey/plugins/signals";
import { toast } from "@bogey/ui/components/toast";
import { useSession } from "#/lib/viewer.ts";
import { ANNOUNCEMENTS } from "#/components/event/messaging/announcements.tsx";
import { useT } from "#/lib/translate.tsx";

const TYPE = { info: "info", warning: "warning", urgent: "error" } as const;

export function AnnouncementToasts({
  eventId,
  slug,
  urgentStays,
}: {
  eventId: string;
  slug: string;
  urgentStays: boolean;
}) {
  const t = useT();
  const options = eventAnnouncementsQueryOptions(eventId);
  const { data } = useQuery(options);
  useLiveInvalidate("announcements", options.queryKey, { filter: `event_id=eq.${eventId}` });
  useLiveBroadcast(announcementsTopic(eventId), options.queryKey);
  const navigate = useNavigate();
  const userId = useSession()?.user.id;
  const onPage = useMatch({
    from: "/_authed/events/$slug/messages",
    shouldThrow: false,
    select: (match) => !match.search.c || match.search.c === ANNOUNCEMENTS,
  });
  const known = useRef<Set<string> | null>(null);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!onPage) return;
    shown.current.forEach((id) => toast.close(id));
    shown.current.clear();
  }, [onPage]);

  useEffect(() => {
    if (!data) return;
    if (!known.current) {
      known.current = new Set(data.map((announcement) => announcement.id));
      return;
    }
    for (const announcement of data) {
      if (known.current.has(announcement.id)) continue;
      known.current.add(announcement.id);
      if (announcement.read || announcement.author_id === userId) continue;
      const urgent = announcement.severity === "urgent";
      emitSignal(urgent ? "announcement.urgent" : "announcement.posted", eventId);
      if (onPage) continue;
      const id = `announcement:${announcement.id}`;
      toast.add({
        id,
        title: announcement.title,
        description: excerpt(announcement.body_md) || (announcement.authorName ?? undefined),
        type: TYPE[announcement.severity],
        priority: urgent ? "high" : "low",
        timeout: urgent && urgentStays ? 0 : 8000,
        position: "bottom-center",
        actionProps: {
          children: t("announcements.read"),
          onClick: () =>
            void navigate({
              to: "/events/$slug/messages",
              params: { slug },
              search: { c: ANNOUNCEMENTS },
            }),
        },
        onRemove: () => shown.current.delete(id),
      });
      shown.current.add(id);
    }
  }, [data, onPage, userId, navigate, slug, urgentStays, t, eventId]);

  return null;
}

function excerpt(markdown: string): string {
  const line = markdown.split("\n").find((text) => text.trim()) ?? "";
  const plain = line.replace(/[#>*_`~|[\]]|\(([^)]*)\)/g, "").trim();
  return plain.length > 140 ? `${plain.slice(0, 139)}...` : plain;
}
