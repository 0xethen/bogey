import type { ResolvedValue } from "@bogey/config/settings";
import { can, type EventAccess } from "@bogey/db/permissions";
import type { Conversation, ConversationAudience } from "@bogey/db/queries/messages";

type Chat = ResolvedValue<"chat">;
type Announcements = ResolvedValue<"announcements">;

export function mayAnnounce(access: EventAccess, announcements: Announcements): boolean {
  return can(access, "event.manage") || (access.role === "judge" && announcements.judges);
}

/** Starting a conversation with one team; the database also refuses judges under blind judging. */
export function mayMessageTeams(access: EventAccess, chat: Chat): boolean {
  if (!chat.enabled) return false;
  return can(access, "event.manage") || (access.role === "judge" && chat.judges);
}

export function mayStart(access: EventAccess, chat: Chat, audience: ConversationAudience): boolean {
  if (!chat.enabled) return false;
  const manager = can(access, "event.manage");
  if (audience === "staff") return chat.staff && (manager || access.role === "judge");
  if (manager) return true;
  return (
    can(access, "event.compete") && chat.participants && (audience === "organizers" || chat.judges)
  );
}

export function mayReply(access: EventAccess, chat: Chat, conversation: Conversation): boolean {
  if (!chat.enabled) return false;
  const { audience } = conversation;
  if (can(access, "event.manage") || can(access, "clarifications.answer")) {
    return audience !== "staff" || chat.staff;
  }
  if (conversation.status === "closed") return false;
  if (access.role === "judge") {
    return (audience === "staff" && chat.staff) || (audience === "judges" && chat.judges);
  }
  return (
    audience !== "staff" &&
    chat.participants &&
    (audience === "organizers" || chat.judges) &&
    conversation.mine
  );
}

export function offeredStarts(access: EventAccess, chat: Chat): ConversationAudience[] {
  if (can(access, "event.manage") || access.role === "judge") return chat.staff ? ["staff"] : [];
  if (access.role === "participant") {
    return ["organizers", ...(chat.judges ? (["judges"] as const) : [])];
  }
  return [];
}

export function offeredReply(access: EventAccess, chat: Chat, conversation: Conversation) {
  if (can(access, "event.manage")) return conversation.audience !== "staff" || chat.staff;
  if (access.role === "judge") {
    return (
      (conversation.audience === "staff" && chat.staff) ||
      (conversation.audience === "judges" && chat.judges)
    );
  }
  return conversation.mine;
}

export function visibleConversations(
  access: EventAccess,
  conversations: Tuple<Conversation>,
): Conversation[] {
  const manages = can(access, "event.manage");
  const judge = !manages && access.role === "judge";
  return conversations.filter((conversation) =>
    manages ? true : judge ? conversation.audience !== "organizers" : conversation.mine,
  );
}
