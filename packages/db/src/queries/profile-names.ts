import type { PostgrestError } from "@supabase/supabase-js";
import type { createServerClient } from "../server.ts";

type Client = ReturnType<typeof createServerClient>;

/**
 * `.in(column, ids)` puts every id in the URL, and a large event's ids make it
 * longer than the gateway accepts ("URI too long"). 100 UUIDs stay near 4 KB.
 */
const CHUNK = 100;

/**
 * Runs `read` once per URL-sized slice of `ids` and joins the rows. Repeats are
 * dropped first. Rows come back in chunk order, so re-sort if order matters.
 */
export async function inChunks<Row>(
  ids: Tuple<string>,
  read: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>,
): Promise<{ data: Row[]; error: PostgrestError | null }> {
  const wanted = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < wanted.length; start += CHUNK) {
    chunks.push(wanted.slice(start, start + CHUNK));
  }
  const results = await Promise.all(chunks.map(read));
  const data: Row[] = [];
  for (const result of results) {
    if (result.error) return { data, error: result.error };
    data.push(...(result.data ?? []));
  }
  return { data, error: null };
}

/** Display names by profile id. Nulls and repeats are skipped. */
export async function profileNames(
  supabase: Client,
  ids: Iterable<string | null | undefined>,
): Promise<{ names: Map<string, string>; error: PostgrestError | null }> {
  const wanted = [...ids].filter((id): id is string => !!id);
  const { data, error } = await inChunks(wanted, (chunk) =>
    supabase.from("profiles").select("id, display_name").in("id", chunk),
  );
  return { names: new Map(data.map((row) => [row.id, row.display_name])), error };
}
