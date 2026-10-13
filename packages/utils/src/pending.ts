export interface Pending<T> {
  key: string;
  savedAt: number;
  value: T;
}

export function queue<T>(
  list: Tuple<Pending<T>>,
  key: string,
  value: T,
  savedAt: number,
): Pending<T>[] {
  return [...list.filter((entry) => entry.key !== key), { key, savedAt, value }];
}

export function dequeue<T>(list: Tuple<Pending<T>>, key: string): Pending<T>[] {
  return list.filter((entry) => entry.key !== key);
}

export function parseQueue<T>(
  text: string | null,
  isValue: (value: unknown) => value is T,
): Pending<T>[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown): Pending<T>[] => {
    if (!entry || typeof entry !== "object") return [];
    const { key, savedAt, value } = entry as { key?: unknown; savedAt?: unknown; value?: unknown };
    return typeof key === "string" && typeof savedAt === "number" && isValue(value)
      ? [{ key, savedAt, value }]
      : [];
  });
}
