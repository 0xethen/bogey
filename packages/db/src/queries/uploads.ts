import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId } from "./validate.ts";

export const uploadLimitFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<number | null>> => {
    const { data, error } = await createServerClient().rpc("upload_limit_mb", { p_event: eventId });
    if (error) return toFailure(error, "loading the upload limit");
    return ok(data);
  });

export const uploadLimitQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["upload-limit", eventId] as const,
    queryFn: async () => unwrap(await uploadLimitFn({ data: eventId })),
    retry: retryPolicy,
    staleTime: 5 * 60_000,
  });
