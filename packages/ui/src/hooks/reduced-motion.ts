import { useExternalValue } from "./external.ts";
import { useMediaQuery } from "./media.ts";

// the account setting sets data-motion="reduce" on <html>
function watchSetting(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-motion"] });
  return () => observer.disconnect();
}

const readSetting = () => document.documentElement.dataset.motion === "reduce";

/** True when the system or the account setting asks for less motion. */
export function useReducedMotion(): boolean {
  const system = useMediaQuery("(prefers-reduced-motion: reduce)");
  const setting = useExternalValue(watchSetting, readSetting, false);
  return system || setting;
}
