import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";

export type Role = Tables<"roles">;

export const rolesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<Role[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.from("roles").select("*").order("key");
    if (error) return toFailure(error, "loading roles");
    return ok(data);
  },
);

export const rolesQueryOptions = () =>
  queryOptions({
    queryKey: ["roles"] as const,
    queryFn: async () => unwrap(await rolesFn()),
    retry: retryPolicy,
    staleTime: 5 * 60_000,
  });

export function roleLabel(roles: Tuple<Role>, key: string): string {
  return roles.find((role) => role.key === key)?.label ?? key;
}
