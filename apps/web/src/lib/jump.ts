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
      const style = getComputedStyle(target);
      const accent = style.getPropertyValue("--color-primary").trim() || "currentColor";
      const wash = `color-mix(in oklch, ${accent} 12%, transparent)`;
      const pad = `calc(${style.getPropertyValue("--spacing").trim() || "0.25rem"} * 2)`;
      animation = target.animate(
        [
          { backgroundColor: wash, boxShadow: `0 0 0 ${pad} ${wash}`, offset: 0 },
          { backgroundColor: wash, boxShadow: `0 0 0 ${pad} ${wash}`, offset: 0.4 },
          { backgroundColor: "transparent", boxShadow: `0 0 0 ${pad} transparent` },
        ],
        { duration: FLASH_MS, easing: "ease-out" },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, [hash]);
}
