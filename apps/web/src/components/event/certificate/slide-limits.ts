// What a deck may be before Bogey stops reading it (docs/guides/certificates.md#importing-slides).
export const DECK_LIMITS = {
  fileMb: 50,
  slides: 60,
  entries: 5000,
  entryBytes: 100 * 1024 * 1024,
  unzippedBytes: 400 * 1024 * 1024,
  svgChars: 40 * 1024 * 1024,
  seconds: 90,
} as const;

export type DeckProblem = "tooBig" | "empty" | "unreadable" | "timeout" | "kind";

export interface DeckRequest {
  bytes: ArrayBuffer;
}

export type DeckResponse = { ok: true; svgs: string[] } | { ok: false; reason: DeckProblem };
