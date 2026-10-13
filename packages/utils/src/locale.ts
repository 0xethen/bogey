export const SOURCE_LOCALE = "en";

const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isLocale(value: string): boolean {
  return LOCALE.test(value);
}

export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param)?.[1])
        .find((value) => value !== undefined);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.tag !== "*" && isLocale(entry.tag) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

export function negotiateLocale(
  wishes: Tuple<string | null | undefined>,
  supported: readonly string[],
): string {
  const lowered = new Map(supported.map((locale) => [locale.toLowerCase(), locale]));
  for (const wish of wishes) {
    if (!wish) continue;
    const exact = lowered.get(wish.toLowerCase());
    if (exact) return exact;
    const language = wish.split("-")[0]?.toLowerCase();
    const base = language ? lowered.get(language) : undefined;
    if (base) return base;
    const sibling = supported.find((locale) => locale.toLowerCase().startsWith(`${language}-`));
    if (sibling) return sibling;
  }
  return SOURCE_LOCALE;
}
