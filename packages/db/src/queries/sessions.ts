import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Enums, Json } from "../types.ts";
import { requireId } from "./validate.ts";

export type SlotKind = Enums<"slot_kind">;
export type SessionVisibility = Enums<"session_visibility">;
export type AttendanceMethod = Enums<"attendance_method">;

const SLOT_KINDS = ["everyone", "choose"] as const satisfies Tuple<SlotKind>;
const VISIBILITIES = ["everyone", "staff"] as const satisfies Tuple<SessionVisibility>;

const sessionRow = z
  .object({
    id: z.string(),
    kind: z.string(),
    name: z.string(),
    description_md: z.string(),
    location: z.string().nullable(),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable(),
    host_note: z.string().nullable(),
    capacity: z.number().nullable(),
    required: z.boolean(),
    takes_attendance: z.boolean(),
    visibility: z.enum(VISIBILITIES),
    category: z.string().nullable(),
    hosts: z.array(z.object({ id: z.string(), name: z.string() })),
    taken: z.number(),
    mine: z.boolean(),
    attended: z.boolean(),
    can_take_attendance: z.boolean(),
  })
  .transform((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    descriptionMd: row.description_md,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    hostNote: row.host_note,
    capacity: row.capacity,
    required: row.required,
    takesAttendance: row.takes_attendance,
    visibility: row.visibility,
    category: row.category,
    hosts: row.hosts,
    taken: row.taken,
    mine: row.mine,
    attended: row.attended,
    canTakeAttendance: row.can_take_attendance,
  }));

const slotRow = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    kind: z.enum(SLOT_KINDS),
    starts_at: z.string(),
    ends_at: z.string().nullable(),
    sessions: z.array(sessionRow),
  })
  .transform((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sessions: row.sessions,
  }));

const agendaRow = z
  .object({
    signups_open: z.boolean(),
    categories: z.array(z.object({ kind: z.string(), label: z.string() })),
    slots: z.array(slotRow),
  })
  .transform((row) => ({
    signupsOpen: row.signups_open,
    categories: row.categories,
    slots: row.slots,
  }));

export type Agenda = z.output<typeof agendaRow>;
export type AgendaSlot = Agenda["slots"][number];
export type AgendaSession = AgendaSlot["sessions"][number];

export const agendaQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["agenda", eventId] as const,
    queryFn: async () => unwrap(await agendaFn({ data: eventId })),
    retry: retryPolicy,
  });

export const agendaFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Agenda>> => {
    const { data, error } = await createServerClient().rpc("event_agenda", { p_event: eventId });
    if (error) return toFailure(error, "loading the agenda");
    const parsed = agendaRow.safeParse(data);
    if (!parsed.success)
      return fail("unavailable", "The agenda came back in a shape Bogey doesn't know.");
    return ok(parsed.data);
  });

const iso = z.iso.datetime({ offset: true });

const sessionInput = z.object({
  id: z.uuid().nullable(),
  kind: z.string().regex(/^[a-z][a-z0-9_-]{0,39}(\.[a-z][a-z0-9_-]{0,39})?$/, "Pick a kind"),
  name: z.string().trim().min(1, "Give the session a name").max(120),
  descriptionMd: z.string().max(20_000),
  location: z.string().trim().max(200),
  startsAt: iso.nullable(),
  endsAt: iso.nullable(),
  hostNote: z.string().trim().max(200),
  hosts: z.array(z.uuid()).max(20),
  capacity: z.number().int().positive().nullable(),
  required: z.boolean(),
  takesAttendance: z.boolean(),
  visibility: z.enum(VISIBILITIES),
  category: z.string().trim().max(40).nullable(),
});

const slotInput = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().max(80),
  kind: z.enum(SLOT_KINDS),
  startsAt: iso,
  endsAt: iso.nullable(),
  sessions: z.array(sessionInput).max(30),
});

const categoryInput = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_-]{0,39}(\.[a-z][a-z0-9_-]{0,39})?$/, "Pick a kind"),
  label: z.string().trim().min(1).max(40),
});

export const agendaInput = z.object({
  eventId: z.uuid(),
  slots: z.array(slotInput).max(100),
});

export type AgendaInput = z.input<typeof agendaInput>;

export const saveAgendaFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => agendaInput.parse(input))
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const agenda: Json = {
      slots: data.slots.map((slot) => ({
        id: slot.id,
        name: slot.name,
        kind: slot.kind,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        sessions: slot.sessions.map((session) => ({
          id: session.id,
          kind: session.kind,
          name: session.name,
          description_md: session.descriptionMd,
          location: session.location,
          starts_at: session.startsAt,
          ends_at: session.endsAt,
          host_note: session.hostNote,
          hosts: session.hosts,
          capacity: session.capacity,
          required: session.required,
          takes_attendance: session.takesAttendance,
          visibility: session.visibility,
          category: session.category,
        })),
      })),
    };
    const { data: removed, error } = await createServerClient().rpc("save_agenda", {
      p_event: data.eventId,
      p_agenda: agenda,
    });
    if (error) return toFailure(error, "saving the agenda");
    return ok(removed ?? 0);
  });

export const sessionLevelsInput = z.object({
  eventId: z.uuid(),
  levels: z.array(categoryInput).max(100),
});

/** Replaces every session type's levels; sessions on a removed level are left without one. */
export const saveSessionLevelsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => sessionLevelsInput.parse(input))
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("save_session_levels", {
      p_event: data.eventId,
      p_levels: data.levels,
    });
    if (error) return toFailure(error, "saving levels");
    return ok(null);
  });

export const chooseSessionFn = createServerFn({ method: "POST" })
  .validator((sessionId: unknown) => requireId(sessionId, "sessionId"))
  .handler(async ({ data: sessionId }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("choose_session", { p_session: sessionId });
    if (error) return toFailure(error, "signing up");
    return ok(null);
  });

export const leaveSlotFn = createServerFn({ method: "POST" })
  .validator((slotId: unknown) => requireId(slotId, "slotId"))
  .handler(async ({ data: slotId }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("leave_session_slot", { p_slot: slotId });
    if (error) return toFailure(error, "dropping your pick");
    return ok(null);
  });

export interface RosterEntry {
  userId: string;
  name: string;
  signedUp: boolean;
  attendedAt: string | null;
  method: AttendanceMethod | null;
}

export const rosterQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: ["session-roster", sessionId] as const,
    queryFn: async () => unwrap(await sessionRosterFn({ data: sessionId })),
    retry: retryPolicy,
  });

export const sessionRosterFn = createServerFn({ method: "GET" })
  .validator((sessionId: unknown) => requireId(sessionId, "sessionId"))
  .handler(async ({ data: sessionId }): Promise<DbResult<RosterEntry[]>> => {
    const { data, error } = await createServerClient().rpc("session_roster", {
      p_session: sessionId,
    });
    if (error) return toFailure(error, "loading the roster");
    return ok(
      (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.display_name,
        signedUp: row.signed_up,
        attendedAt: row.attended_at,
        method: row.method,
      })),
    );
  });

export const setAttendanceFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ sessionId: z.uuid(), userId: z.uuid(), attended: z.boolean() }).parse(input),
  )
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("set_attendance", {
      p_session: data.sessionId,
      p_user: data.userId,
      p_attended: data.attended,
    });
    if (error) return toFailure(error, "marking attendance");
    return ok(null);
  });

export const sessionCodeQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: ["session-code", sessionId] as const,
    queryFn: async () => unwrap(await sessionCodeFn({ data: { sessionId, rotate: false } })),
    retry: retryPolicy,
  });

export const sessionCodeFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ sessionId: z.uuid(), rotate: z.boolean() }).parse(input),
  )
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const { data: code, error } = await createServerClient().rpc("session_code", {
      p_session: data.sessionId,
      p_rotate: data.rotate,
    });
    if (error) return toFailure(error, "loading the check-in code");
    return ok(code);
  });

export const checkInFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ eventId: z.uuid(), code: z.string().trim().min(1, "Enter the code").max(12) })
      .parse(input),
  )
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const { data: name, error } = await createServerClient().rpc("check_in_session", {
      p_event: data.eventId,
      p_code: data.code,
    });
    if (error) return toFailure(error, "checking in");
    return ok(name);
  });

export interface AttendanceRow {
  userId: string;
  name: string;
  sessionId: string;
  expected: boolean;
  attendedAt: string | null;
}

export const attendanceQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["attendance", eventId] as const,
    queryFn: async () => unwrap(await eventAttendanceFn({ data: eventId })),
    retry: retryPolicy,
  });

export const eventAttendanceFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<AttendanceRow[]>> => {
    const { data, error } = await createServerClient().rpc("event_attendance", {
      p_event: eventId,
    });
    if (error) return toFailure(error, "loading attendance");
    return ok(
      (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.display_name,
        sessionId: row.session_id,
        expected: row.expected,
        attendedAt: row.attended_at,
      })),
    );
  });
