import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

const FLASH_MS = 2400;

// The page a `#namespace.key` link lands on scrolls to that setting and washes it in a faint
// accent that fades. The spread shadow pads the wash past the row's edges without moving it;
// `.jump-target` (packages/ui utilities.css) rounds both.
export function useJumpHighlight() {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (!hash) return;
    let animation: Animation | undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(hash));
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      animation = flash(target);
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, [hash]);
}

/** Scrolls to the field holding the control `id`, focuses the control and washes the field. */
export function jumpTo(id: string): void {
  const control = document.getElementById(id);
  if (!control) return;
  const target = control.closest<HTMLElement>('[data-slot="field"]') ?? control;
  control.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  flash(target);
}

function flash(target: HTMLElement): Animation {
  const style = getComputedStyle(target);
  const accent = style.getPropertyValue("--color-primary").trim() || "currentColor";
  // whole sections get a neutral wash instead of the primary one
  const wash =
    target.offsetHeight > 160
      ? "color-mix(in oklch, var(--color-muted-fg) 10%, transparent)"
      : `color-mix(in oklch, ${accent} 12%, transparent)`;
  const pad = `calc(${style.getPropertyValue("--spacing").trim() || "0.25rem"} * 2)`;
  return target.animate(
    [
      { backgroundColor: wash, boxShadow: `0 0 0 ${pad} ${wash}`, offset: 0 },
      { backgroundColor: wash, boxShadow: `0 0 0 ${pad} ${wash}`, offset: 0.4 },
      { backgroundColor: "transparent", boxShadow: `0 0 0 ${pad} transparent` },
    ],
    { duration: FLASH_MS, easing: "ease-out" },
  );
}
