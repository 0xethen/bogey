import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBell, IconChecks } from "@tabler/icons-react";
import {
  markNotificationsReadFn,
  notificationsQueryOptions,
  type Notification,
} from "@bogey/db/queries/notifications";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { emitSignal } from "@bogey/plugins/signals";
import { useT } from "#/lib/translate.tsx";
import { Button } from "@bogey/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@bogey/ui/components/popover";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { cn } from "@bogey/ui/lib/utils";
import { useViewerSession } from "#/lib/viewer.ts";
import { Separator } from "@bogey/ui/components/separator";
import { Empty, EmptyDescription } from "@bogey/ui/components/empty";

function Row({ item, onOpen }: { item: Notification; onOpen: (item: Notification) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-muted"
      >
        <span className="flex items-start gap-2">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              item.read_at ? "bg-transparent" : "bg-primary",
            )}
          />
          <span className={cn("min-w-0 flex-1 text-sm", !item.read_at && "font-medium")}>
            {item.title}
          </span>
        </span>
        {item.body_md && (
          <span className="line-clamp-2 pl-4 text-xs text-muted-fg">{item.body_md}</span>
        )}
        <span className="pl-4 text-xs text-muted-fg">
          <RelativeTime value={item.created_at} />
        </span>
      </button>
    </li>
  );
}

function useNotificationSignals(items: Tuple<Notification> | undefined) {
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!items) return;
    if (!known.current) {
      known.current = new Set(items.map((item) => item.id));
      return;
    }
    for (const item of items) {
      if (known.current.has(item.id)) continue;
      known.current.add(item.id);
      if (!item.read_at && item.kind !== "announcement") {
        emitSignal("notification.received", item.event_id);
      }
    }
  }, [items]);
}

export function NotificationsButton() {
  const t = useT();
  const session = useViewerSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = notificationsQueryOptions();
  const { data } = useQuery({ ...options, enabled: !!session });
  useLiveInvalidate("notifications", options.queryKey, {
    ...(session ? { filter: `user_id=eq.${session.user.id}` } : {}),
    enabled: !!session,
  });
  useNotificationSignals(data?.items);
  const markRead = useMutation({
    mutationFn: async (id: string | null) =>
      unwrap(await markNotificationsReadFn({ data: id ? { id } : {} }).catch(requestFailure)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });

  if (!session) return null;
  const unread = data?.unread ?? 0;
  const open = (item: Notification) => {
    if (!item.read_at) markRead.mutate(item.id);
    if (item.link) router.history.push(item.link);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button size="icon-xs" variant="ghost" className="relative">
            <IconBell />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-fg">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            <span className="sr-only">
              {unread > 0
                ? t("nav.notificationsUnread", { count: unread })
                : t("nav.notifications")}
            </span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-2 p-2">
        <div className="flex items-center justify-between gap-2 px-2 pt-1">
          <h2 className="font-heading text-sm font-semibold">{t("nav.notifications")}</h2>
          <button
            className="link flex items-center gap-1 [&_svg:not([class*='size-'])]:size-4"
            disabled={unread === 0 || markRead.isPending}
            onClick={() => markRead.mutate(null)}
          >
            <IconChecks />
            {t("nav.markAllRead")}
          </button>
        </div>
        <Separator />
        {data && data.items.length > 0 ? (
          <div className="max-h-96 overflow-y-auto overscroll-contain">
            <ul className="flex flex-col">
              {data.items.map((item) => (
                <Row key={item.id} item={item} onOpen={open} />
              ))}
            </ul>
          </div>
        ) : (
          <Empty>
            <EmptyDescription>{t("nav.allCaughtUp")}</EmptyDescription>
          </Empty>
        )}
      </PopoverContent>
    </Popover>
  );
}
