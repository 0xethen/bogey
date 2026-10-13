import { useEffect, useRef, type RefObject } from "react";

export function useActiveInView<T extends HTMLElement>(): RefObject<T | null> {
  const row = useRef<T>(null);
  useEffect(() => {
    const list = row.current;
    const active = list?.querySelector<HTMLElement>('[data-status="active"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const start = active.offsetLeft - list.offsetLeft;
    const end = start + active.offsetWidth;
    if (start >= list.scrollLeft && end <= list.scrollLeft + list.clientWidth) return;
    list.scrollTo({ left: start - (list.clientWidth - active.offsetWidth) / 2 });
  });
  return row;
}
