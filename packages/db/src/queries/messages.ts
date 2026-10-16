import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Tables } from "../types.ts";
import { requireId, requireOneOf, requireText } from "./validate.ts";

export type ConversationStatus = Enums<"clarification_status">;
export type ConversationVisibility = Enums<"clarification_visibility">;

export const AUDIENCES = ["organizers", "judges", "staff"] as const;
export type ConversationAudience = (typeof AUDIENCES)[number];

export const AUTHOR_ROLES = ["participant", "organizer", "judge"] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

export interface MessageAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
}

export const ATTACHMENTS_BUCKET = "message-attachments";
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 10_000;

const attachmentSchema = z.object({
  path: z.string().min(1).max(1024),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
  type: z.string().max(255),
});
export const attachmentsSchema = z.array(attachmentSchema).max(MAX_ATTACHMENTS);

export interface ConversationMessage {
  id: string;
  authorId: string | null;
  authorName: string;
  role: AuthorRole;
  bodyMd: string;
  attachments: MessageAttachment[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  eventId: string;
  subject: string;
  audience: ConversationAudience;
  status: ConversationStatus;
  visibility: ConversationVisibility;
  topic: string;
  askerName: string;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  archived: boolean;
  messages: ConversationMessage[];
}

function audience(value: string): ConversationAudience {
  return AUDIENCES.find((known) => known === value) ?? "organizers";
}

function role(value: string): AuthorRole {
  return AUTHOR_ROLES.find((known) => known === value) ?? "participant";
}

function isArchived(archivedAt: string | undefined, lastMessageAt: string | undefined): boolean {
  if (!archivedAt) return false;
  return !lastMessageAt || Date.parse(lastMessageAt) <= Date.parse(archivedAt);
}

export const eventConversationsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Conversation[]>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const [threads, team] = await Promise.all([
      supabase
        .from("clarifications")
        .select("*")
        .eq("event_id", eventId)
        .order("updated_at", { ascending: false })
        .limit(300),
      userId
        ? supabase
            .from("team_members")
            .select("team_id")
            .eq("event_id", eventId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const failure = threads.error ?? team.error;
    if (failure) return toFailure(failure, "loading messages");
    const rows: Tables<"clarifications">[] = threads.data ?? [];

    const ids = rows.map((thread) => thread.id);
    const [{ data: messages, error: messageError }, { data: archives, error: archiveError }] =
      await Promise.all([
        ids.length
          ? supabase
              .from("clarification_messages")
              .select(
                "id, clarification_id, author_id, author_role, body_md, attachments, created_at",
              )
              .in("clarification_id", ids)
              .is("deleted_at", null)
              .order("created_at")
          : Promise.resolve({ data: [], error: null }),
        ids.length && userId
          ? supabase
              .from("clarification_archives")
              .select("clarification_id, archived_at")
              .eq("user_id", userId)
              .in("clarification_id", ids)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (messageError ?? archiveError) {
      return toFailure(messageError ?? archiveError, "loading messages");
    }
    const archivedAt = new Map(
      archives.map((archive) => [archive.clarification_id, archive.archived_at]),
    );

    const people = [
      ...new Set([
        ...rows.flatMap((thread) => (thread.asked_by ? [thread.asked_by] : [])),
        ...messages.flatMap((message) => (message.author_id ? [message.author_id] : [])),
      ]),
    ];
    const { data: profiles, error: profileError } = people.length
      ? await supabase.from("profiles").select("id, display_name").in("id", people)
      : { data: [], error: null };
    if (profileError) return toFailure(profileError, "loading messages");
    const names = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
    const myTeam = team.data?.team_id ?? null;

    return ok(
      rows.map((thread) => ({
        id: thread.id,
        eventId: thread.event_id,
        subject: thread.subject,
        audience: audience(thread.audience),
        status: thread.status,
        visibility: thread.visibility,
        topic: thread.topic,
        askerName: (thread.asked_by && names.get(thread.asked_by)) || "Someone",
        teamId: thread.team_id,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        mine: (!!userId && thread.asked_by === userId) || (!!myTeam && thread.team_id === myTeam),
        archived: isArchived(
          archivedAt.get(thread.id),
          messages.findLast((message) => message.clarification_id === thread.id)?.created_at,
        ),
        messages: messages
          .filter((message) => message.clarification_id === thread.id)
          .map((message) => ({
            id: message.id,
            authorId: message.author_id,
            role: role(message.author_role),
            authorName:
              (message.author_id && names.get(message.author_id)) ||
              (message.author_role === "organizer" ? "Organizers" : "Someone"),
            bodyMd: message.body_md,
            attachments: attachmentsSchema.catch([]).parse(message.attachments),
            createdAt: message.created_at,
          })),
      })),
    );
  });

export const eventConversationsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["conversations", eventId] as const,
    queryFn: async () => unwrap(await eventConversationsFn({ data: eventId })),
    retry: retryPolicy,
  });

const TOPIC = /^(general|[a-z][a-z0-9-]*\.[a-z0-9-]+(:[0-9a-f-]+)?)$/;

export const startConversationFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      eventId?: unknown;
      subject?: unknown;
      body?: unknown;
      audience?: unknown;
      topic?: unknown;
    };
    const topic = raw.topic ?? "general";
    if (typeof topic !== "string" || topic.length > 120 || !TOPIC.test(topic)) {
      throw new Error("Topic must be general or a plugin's own.");
    }
    return {
      eventId: requireId(raw.eventId, "eventId"),
      subject: requireText(raw.subject, "Subject", 140),
      body: requireText(raw.body, "Message", 10_000),
      audience: requireOneOf(raw.audience ?? "organizers", AUDIENCES, "Audience"),
      topic,
    };
  })
  .handler(async ({ data }): Promise<DbResult<{ id: string }>> => {
    const supabase = createServerClient();
    const { data: row, error } = await supabase.rpc("ask_clarification", {
      p_event: data.eventId,
      p_subject: data.subject,
      p_body: data.body,
      p_audience: data.audience,
      p_topic: data.topic,
    });
    if (error) {
      if (error.code === "42501") return fail("forbidden", "You can't start that conversation.");
      return toFailure(error, "sending your message");
    }
    return ok({ id: row.id });
  });

export const messageTeamFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      eventId?: unknown;
      teamId?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      teamId: requireId(raw.teamId, "Team"),
      subject: requireText(raw.subject, "Subject", 140),
      body: requireText(raw.body, "Message", 10_000),
    };
  })
  .handler(async ({ data }): Promise<DbResult<{ id: string }>> => {
    const supabase = createServerClient();
    const { data: row, error } = await supabase.rpc("message_team", {
      p_event: data.eventId,
      p_team: data.teamId,
      p_subject: data.subject,
      p_body: data.body,
    });
    if (error) {
      if (error.code === "42501") return fail("forbidden", "You can't message that team.");
      return toFailure(error, "sending your message");
    }
    return ok({ id: row.id });
  });

export const sendMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      eventId?: unknown;
      conversationId?: unknown;
      body?: unknown;
      attachments?: unknown;
    };
    const attachments = attachmentsSchema.safeParse(raw.attachments ?? []);
    if (!attachments.success) throw new Error("Those attachments can't be sent.");
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw new Error(
        `Message must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`,
      );
    }
    if (!body && !attachments.data.length) throw new Error("Write a message or attach something.");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      conversationId: requireId(raw.conversationId, "conversationId"),
      body,
      attachments: attachments.data,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.from("clarification_messages").insert({
      event_id: data.eventId,
      clarification_id: data.conversationId,
      body_md: data.body,
      attachments: data.attachments.map((attachment) => ({ ...attachment })),
    });
    if (error) {
      if (error.code === "42501")
        return fail("forbidden", "This conversation is closed to replies.");
      return toFailure(error, "sending your message");
    }
    return ok(null);
  });

export const updateConversationFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; status?: unknown; visibility?: unknown };
    return {
      id: requireId(raw.id, "id"),
      status:
        raw.status === undefined
          ? undefined
          : requireOneOf(raw.status, ["open", "answered", "closed"], "Status"),
      visibility:
        raw.visibility === undefined
          ? undefined
          : requireOneOf(raw.visibility, ["private", "public"], "Visibility"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from("clarifications")
      .update({
        ...(data.status ? { status: data.status } : {}),
        ...(data.visibility ? { visibility: data.visibility } : {}),
      })
      .eq("id", data.id)
      .select("id");
    if (error) return toFailure(error, "updating the conversation");
    if (!rows.length) return fail("forbidden", "Only organizers can change this conversation.");
    return ok(null);
  });

export const archiveConversationFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; archived?: unknown };
    if (typeof raw.archived !== "boolean") throw new Error("Say whether to archive it.");
    return { id: requireId(raw.id, "id"), archived: raw.archived };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId)
      return fail("forbidden", "Your credentials are invalid or expired. Please log in again.");
    const { error } = data.archived
      ? await supabase.from("clarification_archives").upsert({
          clarification_id: data.id,
          user_id: userId,
          archived_at: new Date().toISOString(),
        })
      : await supabase
          .from("clarification_archives")
          .delete()
          .eq("clarification_id", data.id)
          .eq("user_id", userId);
    if (error) {
      if (error.code === "42501") return fail("forbidden", "You can't archive that conversation.");
      return toFailure(error, data.archived ? "archiving it" : "bringing it back");
    }
    return ok(null);
  });
