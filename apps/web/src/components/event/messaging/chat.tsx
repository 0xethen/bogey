import type { ReactNode } from "react";
import { formatDate, formatDateTime } from "@bogey/utils/time";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Bubble, BubbleContent } from "@bogey/ui/components/chat/bubble";
import { Markdown } from "@bogey/ui/components/markdown";
import { Marker, MarkerContent } from "@bogey/ui/components/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "./message.tsx";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@bogey/ui/components/chat/message-scroller";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { cn } from "@bogey/ui/lib/utils";
import { useT } from "#/lib/translate.tsx";

const SIDE_ACTIONS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100 pointer-coarse:opacity-100";

const TONE_BUBBLE = {
  info: "",
  warning: "*:data-[slot=bubble-content]:bg-warning/15",
  urgent: "*:data-[slot=bubble-content]:bg-destructive/15",
} as const;

export function ChatMessage({
  authorName,
  role,
  avatarInHeader = false,
  own = false,
  at,
  tone = "info",
  title,
  meta,
  actions,
  sideActions,
  attachments,
  children,
}: {
  authorName: string;
  role?: string | null;
  /** Show the avatar beside the name instead of beside the bubble. */
  avatarInHeader?: boolean;
  own?: boolean;
  at: string;
  tone?: keyof typeof TONE_BUBBLE;
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  sideActions?: ReactNode;
  attachments?: ReactNode;
  children?: string | null;
}) {
  const time = useTimeFormat();
  return (
    <Message align={own ? "end" : "start"}>
      {!own && !avatarInHeader && (
        <MessageAvatar className="min-w-0">
          <NameAvatar name={authorName} />
        </MessageAvatar>
      )}
      <MessageContent>
        {!own && (
          <MessageHeader className={cn("gap-1.5", avatarInHeader && "gap-2 px-0")}>
            {avatarInHeader && <NameAvatar name={authorName} size="xs" />}
            {authorName}
            {role && <span className="font-normal">· {role}</span>}
          </MessageHeader>
        )}
        {(title || children) && (
          <div
            data-slot="message-row"
            className={cn("flex w-full min-w-0 items-center gap-1.5", own && "flex-row-reverse")}
          >
            <Bubble
              variant={own ? "default" : "muted"}
              className={cn(
                title && (sideActions ? "max-w-[calc(100%-2.5rem)]" : "max-w-full"),
                TONE_BUBBLE[tone],
              )}
            >
              <BubbleContent className={cn(title && "flex flex-col gap-1")}>
                {title && <p className="font-medium">{title}</p>}
                {children && (
                  <Markdown className="text-inherit [&>style+*]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-inherit">
                    {children}
                  </Markdown>
                )}
              </BubbleContent>
            </Bubble>
            {sideActions && <div className={SIDE_ACTIONS}>{sideActions}</div>}
          </div>
        )}
        {attachments && (
          <div
            data-slot="message-attachments"
            className={cn("flex w-full min-w-0 items-center gap-1.5", own && "flex-row-reverse")}
          >
            <div className="min-w-0 max-w-[80%]">{attachments}</div>
            {!(title || children) && sideActions && (
              <div className={SIDE_ACTIONS}>{sideActions}</div>
            )}
          </div>
        )}
        <MessageFooter className="flex-wrap gap-1.5">
          <time dateTime={at} title={formatDateTime(at, time)}>
            <RelativeTime value={at} />
          </time>
          {meta}
          {actions}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

export function ChatFeed<T extends { id: string }>({
  label,
  items,
  at,
  firstNew,
  className,
  children,
}: {
  label: string;
  items: Tuple<T>;
  at: (item: T) => string;
  firstNew?: string;
  className?: string;
  children: (item: T) => ReactNode;
}) {
  const t = useT();
  const time = useTimeFormat();
  return (
    <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
      <MessageScroller className={cn("min-h-0 flex-1", className)}>
        <MessageScrollerViewport aria-label={label} className="px-4">
          <MessageScrollerContent className="gap-4 py-4">
            {items.map((item, index) => {
              const day = formatDate(at(item), time);
              const previous = items[index - 1];
              const newDay = !previous || formatDate(at(previous), time) !== day;
              return (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  scrollAnchor={item.id === firstNew}
                >
                  {item.id === firstNew ? (
                    <Marker
                      variant="separator"
                      className="mb-4 text-xs font-medium text-primary-text"
                    >
                      <MarkerContent>{t("chat.new")}</MarkerContent>
                    </Marker>
                  ) : (
                    newDay && (
                      <Marker variant="separator" className="mb-4 text-xs">
                        <MarkerContent>{day}</MarkerContent>
                      </Marker>
                    )
                  )}
                  {children(item)}
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
