import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { loadedPluginSlots, readPluginSettings } from "@bogey/plugins";
import { emitSignal } from "@bogey/plugins/signals";
import { pluginSettingsQueryOptions } from "#/lib/plugins.ts";
import { useEvent, useEventViewer, useSession } from "#/lib/viewer.ts";
import { z } from "zod";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";
import {
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconChevronDown,
  IconPlus,
  IconShare3,
  IconSpeakerphone,
  IconUsersGroup,
} from "@tabler/icons-react";
import { browserClient } from "@bogey/db/browser";
import {
  archiveConversationFn,
  ATTACHMENTS_BUCKET,
  blockFromChatFn,
  chatBlocksQueryOptions,
  eventConversationsQueryOptions,
  messageTeamFn,
  sendMessageFn,
  startConversationFn,
  updateConversationFn,
  type Conversation,
  type ConversationAudience,
  type ConversationMessage,
} from "@bogey/db/queries/messages";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { audienceChoicesQueryOptions, type Announcement } from "@bogey/db/queries/announcements";
import { Badge } from "@bogey/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { Button } from "@bogey/ui/components/button";
import { DropdownMenuItem } from "@bogey/ui/components/dropdown-menu";
import { toast } from "@bogey/ui/components/toast";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bogey/ui/components/dialog";
import { FieldGroup } from "@bogey/ui/components/field";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { cn } from "@bogey/ui/lib/utils";
import {
  appFormOptions,
  errorVisibility,
  FieldCombobox,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { newAnnouncement } from "#/components/event/messaging/announcement-composer.tsx";
import { ANNOUNCEMENTS } from "#/components/event/messaging/announcements.tsx";
import { ChatFeed, ChatMessage } from "#/components/event/messaging/chat.tsx";
import { MessageBox } from "#/components/event/messaging/message-box.tsx";
import { MessageAttachments } from "#/components/event/messaging/message-attachments.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";

const eventRoute = getRouteApi("/_authed/events/$slug");

export const messagesSearch = z.object({
  c: z
    .union([z.literal(ANNOUNCEMENTS), z.string().uuid()])
    .optional()
    .catch(undefined),
});

export const AUDIENCE_LABEL = {
  organizers: "conv.toOrganizers",
  judges: "conv.toJudges",
  staff: "conv.toStaff",
} as const satisfies Record<ConversationAudience, PlainKey>;

const ROLE_LABEL = { organizer: "conv.organizer", judge: "conv.judge", participant: null } as const;

function roleText(role: keyof typeof ROLE_LABEL, t: T): string | null {
  const key = ROLE_LABEL[role];
  return key ? t(key) : null;
}

const STATUS = {
  open: { tone: "attention", label: "conv.waiting" },
  answered: { tone: "done", label: "conv.replied" },
  closed: { tone: "idle", label: "conv.closed" },
} as const;

export function Conversations({
  conversations,
  announcements,
  openId,
  onOpen,
  start = [],
  messageTeams = false,
  canReply = () => false,
  moderate = false,
  forward = false,
  empty,
}: {
  conversations?: Tuple<Conversation>;
  announcements: { channel: ReactNode; latest: Announcement | undefined; unread: number };
  openId: string | undefined;
  onOpen: (id: string | undefined) => void;
  start?: Tuple<ConversationAudience>;
  messageTeams?: boolean;
  canReply?: (conversation: Conversation) => boolean;
  moderate?: boolean;
  forward?: boolean;
  empty?: string;
}) {
  const t = useT();
  const open = conversations?.find((conversation) => conversation.id === openId);
  const showAnnouncements = !open;
  const picked = openId !== undefined;

  if (!conversations) {
    return <div className={cn(FRAME, "flex flex-col")}>{announcements.channel}</div>;
  }
  const current = conversations.filter((conversation) => !conversation.archived);
  const archived = conversations.filter((conversation) => conversation.archived);

  return (
    <div className={cn(FRAME, "grid lg:grid-cols-[20rem_minmax(0,1fr)]")}>
      <aside
        className={cn(
          "flex min-h-0 flex-col border-border lg:border-r",
          picked && "hidden lg:flex",
        )}
      >
        {(start.length > 0 || messageTeams) && (
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2 border-b border-border p-3">
            {start.length > 0 && (
              <DialogTrigger
                handle={newConversation}
                render={<Button className="flex-none sm:flex-1 lg:flex-none" />}
              >
                <IconPlus />
                {t("conv.new")}
              </DialogTrigger>
            )}
            {messageTeams && (
              <DialogTrigger
                handle={teamConversation}
                render={<Button variant={start.length > 0 ? "outline" : "default"} />}
              >
                <IconUsersGroup />
                {t("conv.messageTeam")}
              </DialogTrigger>
            )}
          </div>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <li>
            <AnnouncementsRow
              latest={announcements.latest}
              unread={announcements.unread}
              active={showAnnouncements}
              onOpen={() => onOpen(ANNOUNCEMENTS)}
            />
          </li>
          {current.map((conversation) => (
            <li key={conversation.id}>
              <ConversationRow
                conversation={conversation}
                active={conversation.id === openId}
                onOpen={() => onOpen(conversation.id)}
              />
            </li>
          ))}
          {current.length === 0 && empty && (
            <li className="p-4 text-sm text-muted-fg border-b">{empty}</li>
          )}
          {archived.length > 0 && (
            <li>
              <Collapsible
                defaultOpen={archived.some((conversation) => conversation.id === openId)}
              >
                <CollapsibleTrigger className="group flex w-full items-center gap-2 border-b border-border px-4 py-2 text-left text-xs font-medium text-muted-fg hover:bg-muted/50">
                  <IconArchive className="size-4" />
                  <span className="flex-1">{t("conv.archived", { count: archived.length })}</span>
                  <IconChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul>
                    {archived.map((conversation) => (
                      <li key={conversation.id}>
                        <ConversationRow
                          conversation={conversation}
                          active={conversation.id === openId}
                          onOpen={() => onOpen(conversation.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </li>
          )}
        </ul>
      </aside>

      <section className={cn("min-h-0 flex-col", picked ? "flex" : "hidden lg:flex")}>
        {open ? (
          <OpenConversation
            key={open.id}
            conversation={open}
            canReply={canReply(open)}
            moderate={moderate}
            forward={forward}
            onBack={() => onOpen(undefined)}
          />
        ) : (
          <Fragment key={picked ? "picked" : "beside"}>
            <ChannelHeader
              title={t("announcements.title")}
              description={t("conv.messageCount", { count: 0 })}
              onBack={() => onOpen(undefined)}
            />
            {announcements.channel}
          </Fragment>
        )}
      </section>

      <NewConversationDialog audiences={start} onStarted={(id) => onOpen(id)} />
      {messageTeams && <MessageTeamDialog onStarted={(id) => onOpen(id)} />}
    </div>
  );
}

const FRAME =
  "min-h-[32rem] overflow-hidden rounded-2xl border border-border lg:h-[calc(100dvh-var(--layout-offset,0px)-14rem)]";

function ChannelHeader({
  title,
  description,
  onBack,
  children,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="flex flex-wrap items-center gap-y-1 border-b border-border px-4 py-3">
      {onBack && (
        <Button size="icon-sm" variant="ghost" className="lg:hidden" onClick={onBack}>
          <IconArrowLeft />
          <span className="sr-only">{t("conv.allMessages")}</span>
        </Button>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate font-medium">{title}</h2>
        <p className="text-xs text-muted-fg">{description}</p>
      </div>
      {children}
    </header>
  );
}

function AnnouncementsRow({
  latest,
  unread,
  active,
  onOpen,
}: {
  latest: Announcement | undefined;
  unread: number;
  active: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(ROW, "lg:aria-[current]:bg-muted")}
    >
      <span className="flex items-center gap-2">
        <IconSpeakerphone className="size-4 shrink-0 text-muted-fg" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("announcements.title")}
        </span>
        {unread < 0 ? (
          <Badge>{t("conv.unread", { count: unread })}</Badge>
        ) : (
          latest && (
            <span className="shrink-0 text-xs text-muted-fg">
              <RelativeTime value={latest.publish_at} />
            </span>
          )
        )}
      </span>
      <span className="truncate pl-6 text-xs text-muted-fg">
        {latest ? latest.title : t("announcements.emptyManage")}
      </span>
    </button>
  );
}

const ROW =
  "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/50";

function ConversationRow({
  conversation,
  active,
  onOpen,
}: {
  conversation: Conversation;
  active: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const last = conversation.messages.at(-1);
  const status = STATUS[conversation.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(ROW, "aria-[current]:bg-muted")}
    >
      <span className="flex items-center gap-2">
        <StatusDot tone={status.tone} label={t(status.label)} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{conversation.subject}</span>
        <span className="shrink-0 text-xs text-muted-fg">
          <RelativeTime value={conversation.updatedAt} />
        </span>
      </span>
      <span className="truncate pl-4 text-xs text-muted-fg">
        {last &&
          `${last.authorName}: ${
            last.bodyMd.replace(/\s+/g, " ") ||
            t("conv.sentFiles", { count: last.attachments.length })
          }`}
      </span>
    </button>
  );
}

function OpenConversation({
  conversation,
  canReply,
  moderate,
  forward,
  onBack,
}: {
  conversation: Conversation;
  canReply: boolean;
  moderate: boolean;
  forward: boolean;
  onBack: () => void;
}) {
  const viewerId = eventRoute.useRouteContext({ select: (context) => context.session.user.id });
  const t = useT();
  return (
    <>
      <ChannelHeader
        title={conversation.subject}
        description={
          conversation.teamId
            ? t("conv.withTeam", {
                who: t(AUDIENCE_LABEL[conversation.audience]).toLowerCase(),
                asker: conversation.askerName,
              })
            : t("conv.with", {
                who: t(AUDIENCE_LABEL[conversation.audience]).toLowerCase(),
                asker: conversation.askerName,
              })
        }
        onBack={onBack}
      >
        {/* {(conversation.visibility === "public" && import.meta.env.DEV) && (
          <Badge variant="secondary">{t("conv.shared")}</Badge>
        )} */}
        {moderate && <Moderation conversation={conversation} />}
        <ArchiveButton conversation={conversation} />
      </ChannelHeader>
      <TopicContext conversation={conversation} />

      <ChatFeed
        label={t("eventTab.messages")}
        items={conversation.messages}
        at={(message) => message.createdAt}
      >
        {(message) => (
          <ChatMessage
            authorName={message.authorName}
            role={roleText(message.role, t)}
            own={message.authorId === viewerId}
            at={message.createdAt}
            attachments={
              message.attachments.length > 0 && (
                <MessageAttachments attachments={message.attachments} />
              )
            }
            menu={forward && <ForwardItem conversation={conversation} message={message} />}
          >
            {message.bodyMd || null}
          </ChatMessage>
        )}
      </ChatFeed>

      {canReply && conversation.status !== "closed" ? (
        <Composer conversation={conversation} />
      ) : (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-fg">
          {conversation.status === "closed" ? t("conv.isClosed") : t("conv.readOnly")}
        </p>
      )}
    </>
  );
}

function TopicContext({ conversation }: { conversation: Conversation }) {
  const viewer = useEventViewer();
  const session = useSession();
  const key = conversation.topic.split(".")[0] ?? "";
  const manifest = viewer?.plugins.find((plugin) => plugin.key === key);
  const Topic = manifest
    ? loadedPluginSlots().find((loaded) => loaded.key === manifest.key)?.slots.conversationTopic
    : undefined;
  const stored = useQuery({
    ...pluginSettingsQueryOptions(conversation.eventId, key),
    enabled: !!Topic,
  });
  if (!manifest || !Topic || !session || !stored.isSuccess) return null;
  return (
    <div className="max-h-[45%] overflow-y-auto border-b border-border px-4 py-3 scrollbar-thin">
      <Topic
        eventId={conversation.eventId}
        settings={readPluginSettings(manifest, stored.data)}
        session={session}
        topic={conversation.topic}
      />
    </div>
  );
}

function Composer({ conversation }: { conversation: Conversation }) {
  const queryClient = useQueryClient();
  return (
    <MessageBox
      eventId={conversation.eventId}
      folderId={conversation.id}
      onSend={async ({ body, attachments }) => {
        const result = await sendMessageFn({
          data: {
            eventId: conversation.eventId,
            conversationId: conversation.id,
            body,
            attachments,
          },
        }).catch(requestFailure);
        if (!result.ok) return result.error.message;
        emitSignal("message.sent", conversation.eventId);
        await queryClient.invalidateQueries({
          queryKey: eventConversationsQueryOptions(conversation.eventId).queryKey,
        });
        return undefined;
      }}
    />
  );
}

function ArchiveButton({ conversation }: { conversation: Conversation }) {
  const t = useT();
  const queryClient = useQueryClient();
  const archive = useMutation({
    mutationFn: async (archived: boolean) =>
      unwrap(await archiveConversationFn({ data: { id: conversation.id, archived } })),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: eventConversationsQueryOptions(conversation.eventId).queryKey,
      }),
  });
  const label = conversation.archived ? t("conv.unarchive") : t("conv.archive");
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      tooltip={archive.error ? t("conv.couldnt", { error: archive.error.message }) : label}
      disabled={archive.isPending}
      onClick={() => archive.mutate(!conversation.archived)}
    >
      {conversation.archived ? <IconArchiveOff /> : <IconArchive />}
    </Button>
  );
}

function ForwardItem({
  conversation,
  message,
}: {
  conversation: Conversation;
  message: ConversationMessage;
}) {
  const t = useT();
  const forward = useMutation({
    mutationFn: async () => {
      const storage = browserClient().storage.from(ATTACHMENTS_BUCKET);
      const texts = await Promise.all(
        message.attachments
          .filter((attachment) => attachment.type.startsWith("text/"))
          .map(async (attachment) => {
            const { data, error } = await storage.download(attachment.path);
            if (error) throw error;
            return data.text();
          }),
      );
      newAnnouncement.openWithPayload({
        title: conversation.subject.slice(0, 140),
        body: [message.bodyMd, ...texts].filter(Boolean).join("\n\n"),
      });
    },
    onError: (error) =>
      toast.add({ title: t("conv.forwardFailed", { error: error.message }), type: "error" }),
  });
  return (
    <DropdownMenuItem disabled={forward.isPending} onClick={() => forward.mutate()}>
      <IconShare3 />
      {t("conv.forward")}
    </DropdownMenuItem>
  );
}

function Moderation({ conversation }: { conversation: Conversation }) {
  const t = useT();
  const queryClient = useQueryClient();
  const update = async (change: {
    status?: "open" | "closed";
    visibility?: "public" | "private";
  }) => {
    await updateConversationFn({ data: { id: conversation.id, ...change } }).catch(requestFailure);
    await queryClient.invalidateQueries({
      queryKey: eventConversationsQueryOptions(conversation.eventId).queryKey,
    });
  };
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void update({ status: conversation.status === "closed" ? "open" : "closed" })
        }
      >
        {conversation.status === "closed" ? t("conv.reopen") : t("common.close")}
      </Button>
      {conversation.audience === "organizers" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void update({ visibility: conversation.visibility === "public" ? "private" : "public" })
          }
        >
          {conversation.visibility === "public" ? t("conv.unshare") : t("conv.share")}
        </Button>
      )}
      {(conversation.teamId || (conversation.askerId && !conversation.mine)) && (
        <BlockButton conversation={conversation} />
      )}
    </div>
  );
}

type BlockTarget = "person" | "team";

const blockSchema = (t: T) =>
  z.object({
    target: z.enum(["person", "team"]).meta({ label: t("conv.blockWho") }),
    reason: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("conv.blockReason") })
      .describe(t("conv.blockReasonHelp")),
  });

// stops the asker or their team from starting or replying to conversations
function BlockButton({ conversation }: { conversation: Conversation }) {
  const t = useT();
  const viewer = useEventViewer();
  const schema = useMemo(() => blockSchema(t), [t]);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const person = conversation.askerId && !conversation.mine ? conversation.askerId : null;
  const targets: { value: BlockTarget; label: string }[] = [
    ...(person
      ? [
          {
            value: "person" as const,
            label: t("conv.blockPerson", { name: conversation.askerName }),
          },
        ]
      : []),
    ...(conversation.teamId ? [{ value: "team" as const, label: t("conv.blockTeam") }] : []),
  ];
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { target: targets[0]?.value ?? "person", reason: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await blockFromChatFn({
        data: {
          eventId: conversation.eventId,
          ...(value.target === "team" ? { teamId: conversation.teamId } : { userId: person }),
          reason: value.reason,
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: chatBlocksQueryOptions(conversation.eventId).queryKey,
      });
      return undefined;
    },
  });
  return (
    <>
      <Button size="sm" variant="ghost-destructive" onClick={() => setOpen(true)}>
        {t("conv.block")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("conv.blockTitle")}</DialogTitle>
            <DialogDescription>
              <Linked
                text={t("conv.blockBody", { messages: LINK })}
                links={[
                  <SettingLink
                    key="messages"
                    to={`/events/${viewer?.event.slug ?? ""}/manage/messages`}
                    hash="blocked"
                  >
                    {t("path.manageMessages")}
                  </SettingLink>,
                ]}
              />
            </DialogDescription>
          </DialogHeader>
          <form.AppForm>
            <form.Form>
              <FieldGroup>
                {targets.length > 1 && (
                  <form.Field name="target">
                    {(field) => (
                      <field.Field>
                        <field.Label />
                        <FieldSelect field={field} options={targets} />
                      </field.Field>
                    )}
                  </form.Field>
                )}
                <form.Field name="reason">{(field) => <field.TextField />}</form.Field>
                <form.FormAlert title={t("conv.blockFailed")} />
                <form.Submit variant="destructive" pending={t("common.saving")}>
                  {t("conv.blockConfirm")}
                </form.Submit>
              </FieldGroup>
            </form.Form>
          </form.AppForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

const newConversation = createDialogHandle<undefined>();

const startSchema = (t: T) =>
  z.object({
    audience: z.enum(["organizers", "judges", "staff"]).meta({ label: t("conv.to") }),
    subject: z
      .string()
      .trim()
      .min(1, t("conv.needSubject"))
      .max(140, t("form.maxLength", { max: 140 }))
      .meta({ label: t("conv.subject") }),
    body: z
      .string()
      .trim()
      .min(1, t("conv.needMessage"))
      .max(10_000, t("form.maxLength", { max: 10_000 }))
      .meta({ label: t("compose.message") }),
  });

function NewConversationDialog({
  audiences,
  onStarted,
}: {
  audiences: Tuple<ConversationAudience>;
  onStarted: (id: string) => void;
}) {
  const t = useT();
  const eventId = useEvent().id;
  const schema = useMemo(() => startSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        audience: audiences[0] ?? "organizers",
        subject: "",
        body: "",
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await startConversationFn({ data: { eventId, ...value } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      emitSignal("conversation.started", eventId);
      formApi.reset();
      newConversation.close();
      await queryClient.invalidateQueries({
        queryKey: eventConversationsQueryOptions(eventId).queryKey,
      });
      onStarted(result.data.id);
      return undefined;
    },
  });
  if (audiences.length === 0) return null;

  return (
    <Dialog handle={newConversation}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("conv.newTitle")}</DialogTitle>
          <DialogDescription>
            {audiences.includes("staff") ? t("conv.staffSees") : t("conv.teamSees")}
          </DialogDescription>
        </DialogHeader>
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              {audiences.length > 1 && (
                <form.Field name="audience">
                  {(field) => (
                    <field.Field>
                      <field.Label />
                      <FieldSelect
                        field={field}
                        options={audiences.map((audience) => ({
                          value: audience,
                          label: t(AUDIENCE_LABEL[audience]),
                        }))}
                      />
                    </field.Field>
                  )}
                </form.Field>
              )}
              <form.Field name="subject">{(field) => <field.TextField required />}</form.Field>
              <form.Field name="body">
                {(field) => <field.MarkdownField rows={4} required features="message" />}
              </form.Field>
              <form.FormAlert title={t("conv.sendFailed")} />
              <form.Submit pending={t("onboarding.sending")}>{t("conv.send")}</form.Submit>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

const teamConversation = createDialogHandle<undefined>();

const teamSchema = (t: T) =>
  z.object({
    teamId: z
      .string()
      .min(1, t("conv.needTeam"))
      .meta({ label: t("conv.team") }),
    subject: z
      .string()
      .trim()
      .min(1, t("conv.needSubject"))
      .max(140, t("form.maxLength", { max: 140 }))
      .meta({ label: t("conv.subject") }),
    body: z
      .string()
      .trim()
      .min(1, t("conv.needMessage"))
      .max(10_000, t("form.maxLength", { max: 10_000 }))
      .meta({ label: t("compose.message") }),
  });

function MessageTeamDialog({ onStarted }: { onStarted: (id: string) => void }) {
  const t = useT();
  const eventId = useEvent().id;
  const schema = useMemo(() => teamSchema(t), [t]);
  const queryClient = useQueryClient();
  const teams = useQuery(audienceChoicesQueryOptions(eventId));
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { teamId: "", subject: "", body: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await messageTeamFn({ data: { eventId, ...value } }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      emitSignal("conversation.started", eventId);
      formApi.reset();
      teamConversation.close();
      await queryClient.invalidateQueries({
        queryKey: eventConversationsQueryOptions(eventId).queryKey,
      });
      onStarted(result.data.id);
      return undefined;
    },
  });
  const options = (teams.data?.teams ?? []).map((team) => ({ value: team.id, label: team.name }));

  return (
    <Dialog handle={teamConversation}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("conv.messageTeamTitle")}</DialogTitle>
          <DialogDescription>{t("conv.messageTeamBody")}</DialogDescription>
        </DialogHeader>
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              <form.Field name="teamId">
                {(field) => (
                  <field.Field>
                    <field.Label />
                    <FieldCombobox
                      field={field}
                      options={options}
                      empty={teams.isPending ? t("common.loading") : t("conv.noTeams")}
                      placeholder={
                        teams.isPending
                          ? t("common.loading")
                          : options.length
                            ? t("conv.searchTeams")
                            : t("conv.noTeams")
                      }
                    />
                  </field.Field>
                )}
              </form.Field>
              <form.Field name="subject">{(field) => <field.TextField required />}</form.Field>
              <form.Field name="body">
                {(field) => <field.MarkdownField rows={4} required features="message" />}
              </form.Field>
              <form.FormAlert title={t("conv.sendFailed")} />
              <form.Submit pending={t("onboarding.sending")}>{t("conv.send")}</form.Submit>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
