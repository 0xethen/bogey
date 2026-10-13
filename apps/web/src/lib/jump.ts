import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

const FLASH_MS = 2400;

export function useJumpHighlight() {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (!hash) return;
    let animation: Animation | undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(hash));
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      const ring = getComputedStyle(target).getPropertyValue("--color-ring") || "currentColor";
      animation = target.animate(
        [
          { outline: `2px solid ${ring}`, outlineOffset: "6px" },
          { outline: "2px solid transparent", outlineOffset: "6px" },
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
