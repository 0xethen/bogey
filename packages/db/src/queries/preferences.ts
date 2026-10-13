import { KEBAB, SNAKE_KEBAB } from "@bogey/utils/keys";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json } from "../types.ts";

export type PreferenceMap = Record<string, Json>;

const NAMESPACE = KEBAB;
const KEY = SNAKE_KEBAB;

export function preferenceId(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

export const getPreferencesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<PreferenceMap>> => {
    const supabase = createServerClient();

    const { data, error } = await supabase.from("user_preferences").select("namespace, key, value");

    if (error) return toFailure(error, "loading your preferences");

    const map: PreferenceMap = {};
    for (const row of data ?? []) map[preferenceId(row.namespace, row.key)] = row.value;

    return ok(map);
  },
);

export const preferencesQueryOptions = () =>
  queryOptions({
    queryKey: ["preferences"] as const,
    queryFn: async () => unwrap(await getPreferencesFn()),
    retry: retryPolicy,
    staleTime: 5 * 60 * 1000,
  });

function storable(value: unknown): NonNullable<Json> | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === null ? null : storable(item)));
    return items.every((item) => item !== undefined) ? items : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const out: { [key: string]: Json | undefined } = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = item === null ? null : storable(item);
      if (kept === undefined) return undefined;
      out[key] = kept;
    }
    return out;
  }
  return undefined;
}

export function requirePreferenceRef(input: unknown): {
  namespace: string;
  key: string;
  value: NonNullable<Json>;
} {
  const raw = (input ?? {}) as Record<string, unknown>;

  if (typeof raw.namespace !== "string" || !NAMESPACE.test(raw.namespace)) {
    throw new Error("A preference namespace is a plugin key, or 'core'.");
  }
  if (typeof raw.key !== "string" || !KEY.test(raw.key)) {
    throw new Error("A preference key is lowercase letters, digits, - and _.");
  }
  if (raw.value === undefined || raw.value === null) {
    throw new Error("A preference needs a value; use false for off.");
  }
  const value = storable(raw.value);
  if (value === undefined) throw new Error("A preference's value must be JSON.");

  return { namespace: raw.namespace, key: raw.key, value };
}

export const setPreferenceFn = createServerFn({ method: "POST" })
  .validator(requirePreferenceRef)
  .handler(async ({ data }): Promise<DbResult<{ namespace: string; key: string; value: Json }>> => {
    const supabase = createServerClient();

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "You need to be signed in.");

    const { error } = await supabase.from("user_preferences").upsert(
      {
        user_id: userData.user.id,
        namespace: data.namespace,
        key: data.key,
        value: data.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,namespace,key" },
    );

    if (error) return toFailure(error, "saving that preference");

    return ok(data);
  });

export function usePreference<T extends Json>(
  namespace: string,
  key: string,
  fallback: T,
  read: (raw: Json) => raw is T,
) {
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
      const previous = queryClient.getQueryData(options.queryKey);
      queryClient.setQueryData(options.queryKey, (current) => ({ ...current, [id]: value }));
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(options.queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries(options),
  });

  const raw = stored.data?.[id];
  return {
    value: raw !== undefined && read(raw) ? raw : fallback,
    set: (value: T) => save.mutate(value),
    loaded: stored.isSuccess,
    error: stored.error ?? save.error,
  };
}
