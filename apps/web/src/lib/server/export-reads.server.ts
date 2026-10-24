export class ExportError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const PAGE = 1000;

/** Reads every page of a query, 1000 rows at a time. */
export async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new ExportError(500, error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

// ids go in the URL, and a few hundred uuids is past what the API gateway takes (414)
export const IN_CHUNK = 100;

/** `readAll` for a `.in(column, ids)` query, asking for the ids a chunk at a time. */
export async function readAllIn<T>(
  ids: Tuple<string>,
  page: (chunk: string[], from: number, to: number) => Page<T>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let start = 0; start < unique.length; start += IN_CHUNK) {
    const chunk = unique.slice(start, start + IN_CHUNK);
    rows.push(...(await readAll((from, to) => page(chunk, from, to))));
  }
  return rows;
}
