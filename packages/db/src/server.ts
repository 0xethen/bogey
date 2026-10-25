import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { getCookies, getRequestIP, setCookie } from "@tanstack/react-start/server";
import { trustProxy } from "@bogey/config";
import { authCookieName, getPublicEnv, serverSupabaseUrl } from "./env.ts";
import { timeoutFetch } from "./fetch.ts";
import type { Database } from "./types.ts";
import { parseViewAs, VIEW_AS_COOKIE, VIEW_AS_HEADER } from "./view-as.ts";

export function createServerClientFor<D>() {
  const { supabaseKey: key } = getPublicEnv();
  const url = serverSupabaseUrl();

  const clientIp = getRequestIP({
    xForwardedFor: trustProxy || process.env.BOGEY_TRUST_PROXY === "1",
  });

  const viewAs = parseViewAs(getCookies()[VIEW_AS_COOKIE]);

  return createSupabaseServerClient<D>(url, key, {
    global: {
      fetch: timeoutFetch(),
      headers: {
        ...(clientIp ? { "x-bogey-client-ip": clientIp } : {}),
        ...(viewAs ? { [VIEW_AS_HEADER]: viewAs } : {}),
      },
    },
    cookieOptions: { name: authCookieName() },
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
