import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { getCookies, getRequestIP, setCookie } from "@tanstack/react-start/server";
import { trustProxy } from "@bogey/config";
import { getPublicEnv } from "./env.ts";
import { timeoutFetch } from "./fetch.ts";
import type { Database } from "./types.ts";

export function createServerClientFor<D>() {
  const { supabaseUrl: url, supabaseKey: key } = getPublicEnv();

  const clientIp = getRequestIP({
    xForwardedFor: trustProxy || process.env.BOGEY_TRUST_PROXY === "1",
  });

  return createSupabaseServerClient<D>(url, key, {
    global: {
      fetch: timeoutFetch(),
      headers: clientIp ? { "x-bogey-client-ip": clientIp } : {},
    },
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookies) {
        cookies.forEach((cookie) => {
          setCookie(cookie.name, cookie.value, cookie.options);
        });
      },
    },
  });
}

export function createServerClient() {
  return createServerClientFor<Database>();
}
