import { useExternalValue } from "./external.ts";

export const BREAKPOINTS = {
  xs: 380,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1536,
} as const;

export function useMediaQuery(query: string): boolean {
  return useExternalValue(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    false,
  );
}

export function useMinWidth(breakpoint: keyof typeof BREAKPOINTS): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[breakpoint]}px)`);
}

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.lg - 1}px)`);
}
