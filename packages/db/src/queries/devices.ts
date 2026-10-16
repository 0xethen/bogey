import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId } from "./validate.ts";

/** One place the caller is signed in (a Supabase auth session). */
export interface SignedInDevice {
  id: string;
  createdAt: string;
  lastActive: string;
  userAgent: string | null;
  ip: string | null;
  /** aal2 when it was verified with an authenticator app or passkey. */
  aal: string | null;
  current: boolean;
}

export const myDevicesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<SignedInDevice[]>> => {
    const { data, error } = await createServerClient().rpc("my_sessions");
    if (error) return toFailure(error, "loading where you're signed in");
    return ok(
      data.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastActive: row.last_active,
        userAgent: row.user_agent,
        ip: row.ip,
        aal: row.aal,
        current: row.current,
      })),
    );
  },
);

export const myDevicesQueryOptions = () =>
  queryOptions({
    queryKey: ["my-devices"] as const,
    queryFn: async () => unwrap(await myDevicesFn()),
    retry: retryPolicy,
  });

export const signOutDeviceFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const { data, error } = await createServerClient().rpc("end_my_session", { p_session: id });
    if (error) return toFailure(error, "signing that device out");
    if (!data) return fail("not_found", "That device is already signed out.");
    return ok(null);
  });

/** "others" keeps this device signed in; "global" signs out everywhere, here included. */
export const signOutDevicesFn = createServerFn({ method: "POST" })
  .validator((scope: unknown) => (scope === "global" ? ("global" as const) : ("others" as const)))
  .handler(async ({ data: scope }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().auth.signOut({ scope });
    if (error) return toFailure(error, "signing out");
    return ok(null);
  });
