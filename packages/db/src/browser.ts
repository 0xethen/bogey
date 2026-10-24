import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "./env.ts";
import { timeoutFetch } from "./fetch.ts";
import type { Database } from "./types.ts";
import { withViewAs } from "./view-as.ts";

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let client: BrowserClient | undefined;

const OPTIONS = { global: { fetch: withViewAs(timeoutFetch()) } };

export function browserClient(): BrowserClient {
  if (!client) {
    const { supabaseUrl, supabaseKey } = getPublicEnv();
    client = createBrowserClient<Database>(supabaseUrl, supabaseKey, OPTIONS);
  }
  return client;
}

export function browserClientFor<D>() {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  return createBrowserClient<D>(supabaseUrl, supabaseKey, OPTIONS);
}
