import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createServerClient } from "./server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "./errors.ts";

export interface Org {
  id: string;
  slug: string;
  name: string;
  status: "active" | "restricted";
  statusReason: string | null;
}

function requestHost(): string {
  return (getRequestHeader("x-forwarded-host") ?? getRequestHeader("host") ?? "")
    .split(",")[0]!
    .trim()
    .toLowerCase();
}

export const getOrgFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<Org | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .rpc("org_for_host", { p_host: requestHost() })
      .maybeSingle();

    if (error) return toFailure(error, "resolving the org for this host");
    if (!data) return ok(null);
    return ok({
      id: data.id,
      slug: String(data.slug),
      name: data.name,
      status: data.status === "restricted" ? "restricted" : "active",
      statusReason: data.status_reason,
    });
  },
);

export interface Suspension {
  name: string;
  reason: string | null;
}

export const getSuspensionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<Suspension | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .rpc("suspended_org_for_host", { p_host: requestHost() })
      .maybeSingle();
    if (error) return toFailure(error, "checking whether this organization is suspended");
    return ok(data ? { name: data.name, reason: data.reason } : null);
  },
);

export const suspensionQueryOptions = () =>
  queryOptions({
    queryKey: ["org", "suspension"] as const,
    queryFn: async () => unwrap(await getSuspensionFn()),
    retry: retryPolicy,
    staleTime: Infinity,
  });

export const orgQueryKey = ["org"] as const;

export const orgQueryOptions = () =>
  queryOptions({
    queryKey: orgQueryKey,
    queryFn: async () => unwrap(await getOrgFn()),
    retry: retryPolicy,
    staleTime: Infinity,
  });
