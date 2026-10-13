import { useQuery } from "@tanstack/react-query";
import { roleLabel, rolesQueryOptions } from "@bogey/db/queries/roles";

export function useRoleLabel(): (key: string) => string {
  const { data } = useQuery(rolesQueryOptions());
  return (key) => roleLabel(data ?? [], key);
}
