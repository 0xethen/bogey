import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  preferenceId,
  preferencesQueryOptions,
  setPreferenceFn,
  type PreferenceMap,
} from "@bogey/db/queries/preferences";
import { unwrap } from "@bogey/db/errors";
import type { Json } from "@bogey/db/types";
import type { PluginManifest } from "./types.ts";

export interface Preference<T> {
  value: T;
  set: (value: T) => void;
  isLoading: boolean;
  error: Error | null;
}

export function createPluginPreferences<const M extends PluginManifest>(manifest: M) {
  const namespace = manifest.key;

  function usePreference<T extends Json>(key: string, fallback: T): Preference<T> {
    const queryClient = useQueryClient();
    const options = preferencesQueryOptions();
    const stored = useQuery(options);

    const id = preferenceId(namespace, key);

    const save = useMutation({
      scope: { id: `preference:${id}` },
      mutationFn: async (value: T) =>
        unwrap(await setPreferenceFn({ data: { namespace, key, value } })),
      onMutate: async (value) => {
        await queryClient.cancelQueries(options);
        const previous = queryClient.getQueryData<PreferenceMap>(options.queryKey);

        queryClient.setQueryData<PreferenceMap>(options.queryKey, (current) => ({
          ...current,
          [id]: value,
        }));

        return { previous };
      },
      onError: (_error, _value, context) => {
        if (context?.previous) queryClient.setQueryData(options.queryKey, context.previous);
      },
      onSettled: () => queryClient.invalidateQueries(options),
    });

    const raw = stored.data?.[id];

    return {
      value: raw === undefined ? fallback : (raw as T),
      set: (value: T) => save.mutate(value),
      isLoading: stored.isPending,
      error: (stored.error ?? save.error) as Error | null,
    };
  }

  return { usePreference, namespace };
}
