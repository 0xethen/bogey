import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

const FLASH_MS = 2400;

// Scrolls to the `#id` a link lands on and washes it in the accent; see
// docs/architecture/ui-conventions.md#color
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
  const wash = style.getPropertyValue("--color-accent").trim() || "transparent";
  // the spread shadow pads the wash past the row's edges without moving it
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
