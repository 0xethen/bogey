import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "./env.ts";
import { timeoutFetch } from "./fetch.ts";
import type { Database } from "./types.ts";

export function createAnonClient() {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: timeoutFetch() },
  });
}
