import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, serviceRoleKey } from "./env.ts";
import { timeoutFetch } from "./fetch.ts";
import type { Database } from "./types.ts";

export function createAdminClient() {
  if ("window" in globalThis) {
    throw new Error("createAdminClient() must never run in the browser");
  }

  const { supabaseUrl: url, supabaseKey: publishable } = getPublicEnv();
  const key = serviceRoleKey();

  if (key.startsWith("sb_publishable_") || key === publishable) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is set to a publishable (anon) key. The admin client would silently run with no privileges, and every query would return empty rather than error. Use the secret/service_role key from your Supabase project's API settings.",
    );
  }

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: timeoutFetch() },
  });
}
