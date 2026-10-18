import { useEffect, useRef, useState } from "react";
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

// Opening the event after a quiet stretch (or being let in mid-day) makes a pile of announcements
// new at once. Only urgent ones pop up for that; the rest have to have gone out since the page
// opened, give or take this much clock difference with the server.
const FRESH_SLACK_MS = 2 * 60_000;

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
  const [openedAt] = useState(() => Date.now());
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
      const fresh = Date.parse(announcement.publish_at) >= openedAt - FRESH_SLACK_MS;
      if (!urgent && !fresh) continue;
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
        wide: true,
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
  }, [data, onPage, userId, navigate, slug, urgentStays, t, eventId, openedAt]);

  return null;
}

function excerpt(markdown: string): string {
  const line = markdown.split("\n").find((text) => text.trim()) ?? "";
  const plain = line.replace(/[#>*_`~|[\]]|\(([^)]*)\)/g, "").trim();
  return plain.length > 140 ? `${plain.slice(0, 139)}...` : plain;
}
