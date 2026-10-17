import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId } from "./validate.ts";
import { resolveSettings } from "@bogey/config/settings";

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

export interface MyDevices {
  devices: SignedInDevice[];
  /** Whether one device can sign out another (security.deviceSignOut in bogey.config.ts). */
  signOutOthers: boolean;
}

type Client = ReturnType<typeof createServerClient>;

async function signOutOthersAllowed(supabase: Client): Promise<DbResult<boolean>> {
  const { data, error } = await supabase.rpc("settings_for", { p_namespaces: ["accounts"] });
  if (error) return toFailure(error, "checking device sign-out");
  const value =
    data && typeof data === "object" && !Array.isArray(data) ? data.accounts : undefined;
  return ok(resolveSettings("accounts", value).deviceSignOut);
}

export const myDevicesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<MyDevices>> => {
    const supabase = createServerClient();
    const [sessions, allowed] = await Promise.all([
      supabase.rpc("my_sessions"),
      signOutOthersAllowed(supabase),
    ]);
    if (sessions.error) return toFailure(sessions.error, "loading where you're signed in");
    if (!allowed.ok) return allowed;
    return ok({
      signOutOthers: allowed.data,
      devices: sessions.data.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastActive: row.last_active,
        userAgent: row.user_agent,
        ip: row.ip,
        aal: row.aal,
        current: row.current,
      })),
    });
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

/**
 * "others" keeps this device signed in and needs security.deviceSignOut; "global" signs out
 * everywhere, here included, so a stolen session can't use it to keep the real one out.
 */
export const signOutDevicesFn = createServerFn({ method: "POST" })
  .validator((scope: unknown) => (scope === "global" ? ("global" as const) : ("others" as const)))
  .handler(async ({ data: scope }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    if (scope === "others") {
      const allowed = await signOutOthersAllowed(supabase);
      if (!allowed.ok) return allowed;
      if (!allowed.data) return fail("forbidden", "Signing out other devices is turned off.");
    }
    const { error } = await supabase.auth.signOut({ scope });
    if (error) return toFailure(error, "signing out");
    return ok(null);
  });
