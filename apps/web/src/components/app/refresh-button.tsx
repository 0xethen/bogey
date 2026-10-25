import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import { cn } from "@bogey/ui/lib/utils";
import { useT } from "#/lib/translate.tsx";

/** Reloads the lists a page shows, for changes made elsewhere that nothing pushed to it. */
export function RefreshButton({ queryKeys }: { queryKeys: Tuple<QueryKey> }) {
  const t = useT();
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () =>
      Promise.all(queryKeys.map((queryKey) => queryClient.refetchQueries({ queryKey }))),
  });
  return (
    <Button
      size="icon-sm"
      variant="outline"
      aria-label={t("common.refresh")}
      tooltip={t("common.refresh")}
      disabled={refresh.isPending}
      onClick={() => refresh.mutate()}
    >
      <IconRefresh className={cn(refresh.isPending && "animate-spin")} />
    </Button>
  );
}
