import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettings, type OwnScope } from "@bogey/db/queries/settings";
import { unwrap } from "@bogey/db/errors";
import type { CoreNamespace, SettingsChanges } from "@bogey/config/settings";

export function useSettingsMutation<N extends CoreNamespace>(scope: OwnScope, namespace: N) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changes: SettingsChanges<N>) =>
      unwrap(await updateSettings(scope, namespace, changes)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
}
