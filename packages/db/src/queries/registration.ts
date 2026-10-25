import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json, Tables } from "../types.ts";
import { answersToJson, readAnswers, requireId, requireText } from "./validate.ts";
import { readFields, type FormField } from "@bogey/utils/registration-form";

export type Registration = Tables<"registrations">;

export {
  FIELD_KINDS,
  type Answer,
  type Answers,
  type FormField,
  type FormFieldKind,
} from "@bogey/utils/registration-form";

export function parseForm(fields: Json | undefined): FormField[] {
  return readFields(fields);
}

export interface MyRegistration {
  registration: Registration | null;
  form: FormField[];
}

export const myRegistrationFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<MyRegistration>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");

    const [registration, form] = await Promise.all([
      supabase
        .from("registrations")
        .select("*")
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .maybeSingle(),
      // only the questions meant for the caller's division and tags
      supabase.rpc("my_onboarding_form", { p_event: eventId }),
    ]);
    const error = registration.error ?? form.error;
    if (error) return toFailure(error, "loading your registration");
    return ok({ registration: registration.data, form: parseForm(form.data) });
  });

export const myRegistrationQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-registration", eventId] as const,
    queryFn: async () => unwrap(await myRegistrationFn({ data: eventId })),
    retry: retryPolicy,
  });

export const registerFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; answers?: unknown; token?: unknown };
    const answers = readAnswers(raw.answers);
    return {
      eventId: requireId(raw.eventId, "eventId"),
      answers,
      token: typeof raw.token === "string" && raw.token ? raw.token : undefined,
    };
  })
  .handler(async ({ data }): Promise<DbResult<Registration>> => {
    const supabase = createServerClient();
    const { data: registration, error } = await supabase.rpc("register_for_event", {
      p_event: data.eventId,
      p_answers: answersToJson(data.answers),
      ...(data.token ? { p_token: data.token } : {}),
    });
    if (error) return toFailure(error, "registering");
    return ok(registration);
  });

export const withdrawFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("withdraw_registration", { p_event: eventId });
    if (error) return toFailure(error, "withdrawing");
    return ok(null);
  });

export const chooseTeamOptionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; team?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      team: raw.team === null ? null : requireText(raw.team, "Team", 60),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("choose_team_option", {
      p_event: data.eventId,
      ...(data.team ? { p_team: data.team } : {}),
    });
    if (error) return toFailure(error, "choosing your team");
    return ok(null);
  });
