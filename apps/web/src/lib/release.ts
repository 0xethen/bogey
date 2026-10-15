import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { updateChecksEnabled, upstream } from "@bogey/config";
import { fail, ok, unwrap, type DbResult } from "@bogey/db/errors";
import { createServerClient } from "@bogey/db/server";
import { checkRelease, type ReleaseCheck } from "@bogey/plugins/releases";
import { httpFetcher } from "@bogey/plugins/updates";

export type { ReleaseCheck };

const CACHE_MS = 60 * 60_000;
// One check an hour for the whole server, however many admins are signed in: GitHub
// allows 60 unauthenticated requests an hour per address.
let cached: { at: number; check: ReleaseCheck } | null = null;

export const releaseCheckFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<ReleaseCheck>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: admin } = userData.user
      ? await supabase
          .from("platform_admins")
          .select("user_id")
          .eq("user_id", userData.user.id)
          .maybeSingle()
      : { data: null };
    if (!admin) return fail("forbidden", "Only instance admins check for releases.");

    const current = __BOGEY_VERSION__;
    if (!updateChecksEnabled()) {
      return ok({ current, latest: null, newer: false, advisories: [] });
    }
    if (cached && Date.now() - cached.at < CACHE_MS) return ok(cached.check);
    const check = await checkRelease(current, upstream, httpFetcher);
    cached = { at: Date.now(), check };
    return ok(check);
  },
);

export const releaseCheckQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "release"] as const,
    queryFn: async () => unwrap(await releaseCheckFn()),
    staleTime: CACHE_MS,
    retry: false,
  });
