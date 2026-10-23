import { useExternalValue } from "@bogey/ui/hooks/external";

export interface DemoScreenSettings {
  timer: boolean;
  /** Minutes left when the timer turns to a warning; 0 for never. */
  warnMinutes: number;
  members: boolean;
  /** Division and prize tracks. */
  details: boolean;
  table: boolean;
  times: boolean;
  queue: boolean;
  judges: boolean;
}

export const DEMO_SCREEN_DEFAULTS: DemoScreenSettings = {
  timer: true,
  warnMinutes: 1,
  members: true,
  details: true,
  table: true,
  times: true,
  queue: true,
  judges: true,
};

const STORAGE_KEY = "bogey.demo-screen";

function load(): DemoScreenSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const saved = new Map(Object.entries(raw));
      const settings = { ...DEMO_SCREEN_DEFAULTS };
      for (const key of Object.keys(settings) as (keyof DemoScreenSettings)[]) {
        const value = saved.get(key);
        if (typeof value === typeof settings[key]) Object.assign(settings, { [key]: value });
      }
      settings.warnMinutes = Math.min(10, Math.max(0, Math.round(settings.warnMinutes)));
      return settings;
    }
  } catch {
    // private windows and blocked storage fall back to the defaults
  }
  return DEMO_SCREEN_DEFAULTS;
}

let current: DemoScreenSettings | null = null;
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};
const read = () => (current ??= load());

/** The demo presentation screen's settings, kept on this device. */
export function useDemoScreenSettings(): [
  DemoScreenSettings,
  (patch: Partial<DemoScreenSettings>) => void,
] {
  const settings = useExternalValue(subscribe, read, DEMO_SCREEN_DEFAULTS);
  const change = (patch: Partial<DemoScreenSettings>) => {
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
