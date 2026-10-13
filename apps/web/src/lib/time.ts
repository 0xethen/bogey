import { useEffect } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useLocale } from "@bogey/ui/lib/locale";
import { usePreference } from "@bogey/db/queries/preferences";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import type { Json } from "@bogey/db/types";
import type { FormatOptions } from "@bogey/utils/time";
import { useSession } from "#/lib/viewer.ts";

const browserTimeZoneFn = createServerFn({ method: "GET" }).handler(async () => {
  const zone = getCookie("tz");
  try {
    if (zone) new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone ?? "UTC";
  } catch {
    return "UTC";
  }
});

export const browserTimeZoneQueryOptions = () =>
  queryOptions({
    queryKey: ["browser-tz"] as const,
    queryFn: () => browserTimeZoneFn(),
    staleTime: Infinity,
  });

// The server learns the zone from a cookie, so a first visit renders in UTC until this runs.
export function useSyncBrowserTimeZone() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    queryClient.setQueryData(browserTimeZoneQueryOptions().queryKey, zone);
  }, [queryClient]);
}

const isBoolean = (raw: Json): raw is boolean => typeof raw === "boolean";

export function useClockPreference() {
  return usePreference<boolean>("core", "clock_24h", false, isBoolean);
}

export function useViewerTimeFormat(): FormatOptions {
  const session = useSession();
  const browser = useQuery(browserTimeZoneQueryOptions());
  const clock = useClockPreference();
  const locale = useLocale();
  return {
    timeZone: session?.profile?.timezone ?? browser.data ?? "UTC",
    locale,
    hour12: !clock.value,
  };
}

export function useEventTimeFormat(
  viewer: FormatOptions,
  event: { id: string; timezone: string },
): FormatOptions {
  const settings = useQuery(settingsQueryOptions({ eventId: event.id }, ["schedule"]));
  return settings.data?.schedule.showEventTimezone === true
    ? { ...viewer, timeZone: event.timezone, zone: true }
    : viewer;
}
