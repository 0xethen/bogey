import { useExternalValue } from "@bogey/ui/hooks/external";
import { GALLERY_SORTS, type GallerySort } from "#/lib/gallery.ts";

export interface ShowSettings {
  /** Seconds each project stays up while playing. */
  seconds: number;
  /** Start over after the last project instead of stopping. */
  loop: boolean;
  /** Start playing as soon as the slideshow opens. */
  autoplay: boolean;
  banner: boolean;
  team: boolean;
  blurb: boolean;
  winners: boolean;
  /** Division and prize tracks. */
  details: boolean;
  counter: boolean;
  progress: boolean;
  /** Seconds left on the slide while playing. */
  timer: boolean;
  sort: GallerySort | null;
}

export const SHOW_DEFAULTS: ShowSettings = {
  seconds: 8,
  loop: false,
  autoplay: false,
  banner: true,
  team: true,
  blurb: true,
  winners: true,
  details: true,
  counter: true,
  progress: true,
  timer: false,
  sort: null,
};

const STORAGE_KEY = "bogey.slideshow";

function loadSettings(): ShowSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const saved = new Map(Object.entries(raw));
      const pick = <K extends keyof ShowSettings>(key: K): ShowSettings[K] => {
        const value = saved.get(key);
        return typeof value === typeof SHOW_DEFAULTS[key]
          ? (value as ShowSettings[K])
          : SHOW_DEFAULTS[key];
      };
      const sort = GALLERY_SORTS.find((each) => each.key === saved.get("sort"))?.key ?? null;
      return {
        seconds: Math.min(60, Math.max(3, pick("seconds"))),
        loop: pick("loop"),
        autoplay: pick("autoplay"),
        banner: pick("banner"),
        team: pick("team"),
        blurb: pick("blurb"),
        winners: pick("winners"),
        details: pick("details"),
        counter: pick("counter"),
        progress: pick("progress"),
        timer: pick("timer"),
        sort,
      };
    }
  } catch {
    // private windows and blocked storage fall back to the defaults
  }
  return SHOW_DEFAULTS;
}

let current: ShowSettings | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};
const read = () => (current ??= loadSettings());

/** The slideshow's settings, kept on this device; the server renders the defaults. */
export function useSlideshowSettings(): [ShowSettings, (patch: Partial<ShowSettings>) => void] {
  const settings = useExternalValue(subscribe, read, SHOW_DEFAULTS);
  const change = (patch: Partial<ShowSettings>) => {
    current = { ...read(), ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // the settings still apply for this visit
    }
    for (const listener of listeners) listener();
  };
  return [settings, change];
}

const seed = Math.floor(Math.random() * 2 ** 31);
const noSubscription = () => () => {};

/** A shuffle's seed: 0 while rendering on the server, so the browser's first paint matches it. */
export function useShuffleSeed(): number {
  return useExternalValue(noSubscription, () => seed, 0);
}
