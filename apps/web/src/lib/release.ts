import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { updateChecksEnabled, upstream } from "@bogey/config";
import { fail, ok, unwrap, type DbResult } from "@bogey/db/errors";
import { createServerClient } from "@bogey/db/server";
import { fetchLatestVersion, httpFetcher } from "@bogey/plugins/updates";
import { compareVersions } from "@bogey/plugins/api";

export interface ReleaseCheck {
  current: string;
  latest: string | null;
  newer: boolean;
  url?: string;
}

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
    if (!updateChecksEnabled()) return ok({ current, latest: null, newer: false });
    const result = await fetchLatestVersion(
      { key: "bogey", name: "Bogey", version: current, source: { repository: upstream } },
      httpFetcher,
    );
    if ("error" in result) return ok({ current, latest: null, newer: false });
    return ok({
      current,
      latest: result.version,
      newer: compareVersions(result.version, current) > 0,
      url: result.url,
    });
  },
);

export const releaseCheckQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "release"] as const,
    queryFn: async () => unwrap(await releaseCheckFn()),
    staleTime: 60 * 60_000,
    retry: false,
  });
