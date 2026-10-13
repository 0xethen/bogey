import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";

export const hasCalendarTokenFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<boolean>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return ok(false);
    const { data, error } = await supabase
      .from("calendar_tokens")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error) return toFailure(error, "checking your calendar link");
    return ok(data !== null);
  },
);

export const hasCalendarTokenQueryOptions = () =>
  queryOptions({
    queryKey: ["calendar-token"] as const,
    queryFn: async () => unwrap(await hasCalendarTokenFn()),
    retry: retryPolicy,
  });

export const createCalendarTokenFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("create_calendar_token");
    if (error) return toFailure(error, "making your calendar link");
    if (!data) return fail("unknown", "The database returned no link.");
    return ok(data);
  },
);

export const revokeCalendarTokenFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("revoke_calendar_token");
    if (error) return toFailure(error, "turning off your calendar link");
    return ok(null);
  },
);
