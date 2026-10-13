import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { sessionQueryKey } from "@bogey/db/auth";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";

export function useEventRefresh(eventId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["event"] }),
      queryClient.invalidateQueries({ queryKey: ["events"] }),
      queryClient.invalidateQueries({ queryKey: eventWindowsQueryOptions(eventId).queryKey }),
    ]);
    await router.invalidate();
  };
}

export function useSessionRefresh() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    await router.invalidate();
  };
}
