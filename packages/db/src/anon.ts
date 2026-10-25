import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, serverSupabaseUrl } from "./env.ts";
import { timeoutFetch } from "./fetch.ts";
import type { Database } from "./types.ts";

export function createAnonClient() {
  const { supabaseKey } = getPublicEnv();
  return createClient<Database>(serverSupabaseUrl(), supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: timeoutFetch() },
  });
}
