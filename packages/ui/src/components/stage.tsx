import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@bogey/ui/lib/utils";
import {
  dragRect,
  stageTargets,
  type StageGrip,
  type StageGuides,
  type StageRect,
} from "../lib/stage.ts";
import { useUiText } from "../lib/ui-text.ts";

export type { StageRect } from "../lib/stage.ts";

export interface StageItem extends StageRect {
  id: string;
  /** Names it for screen readers. */
  label: string;
  /** Keeps width and height equal while resizing. */
  square?: boolean;
}

const GRIPS: { grip: Exclude<StageGrip, "move">; className: string }[] = [
  { grip: "nw", className: "-top-1.5 -left-1.5 cursor-nwse-resize" },
  { grip: "n", className: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { grip: "ne", className: "-top-1.5 -right-1.5 cursor-nesw-resize" },
  { grip: "e", className: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" },
  { grip: "se", className: "-right-1.5 -bottom-1.5 cursor-nwse-resize" },
  { grip: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { grip: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { grip: "w", className: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" },
];

const SNAP_PX = 6;

function percent(value: number, of: number): string {
  return `${(value / of) * 100}%`;
}

/**
 * A page of `width` × `height` units holding items people drag, resize (handles, or Alt+arrows)
 * and nudge (arrows, Shift for ten), snapping to the page's edges and middle and to each other
 * (hold Alt while dragging to place freely). `children` draws the background.
 */
export function Stage({
  width,
  height,
  items,
  selected,
  onSelect,
  onChange,
  onRemove,
  renderItem,
  label,
  className,
  children,
}: {
  width: number;
  height: number;
  items: readonly StageItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, rect: StageRect) => void;
  onRemove?: (id: string) => void;
  renderItem: (item: StageItem) => ReactNode;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const t = useUiText();
  const hint = useId();
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [guides, setGuides] = useState<StageGuides>({ x: [], y: [] });
  const page = { width, height };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setScale(element.clientWidth / width || 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  const start = (event: PointerEvent, item: StageItem, grip: StageGrip) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(item.id);
    (event.currentTarget.closest("[data-stage-item]") as HTMLElement | null)?.focus();
    const origin = { x: event.clientX, y: event.clientY };
    const targets = stageTargets(
      page,
      items.filter((other) => other.id !== item.id),
    );
    const move = (next: globalThis.PointerEvent) => {
      const result = dragRect(
        item,
        grip,
        (next.clientX - origin.x) / scale,
        (next.clientY - origin.y) / scale,
        {
          page,
          targets: next.altKey ? undefined : targets,
          threshold: SNAP_PX / scale,
          square: item.square,
        },
      );
      setGuides(result.guides);
      onChange(item.id, result.rect);
    };
    const end = () => {
      setGuides({ x: [], y: [] });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const key = (event: KeyboardEvent, item: StageItem) => {
    const step = event.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      const grip: StageGrip = event.altKey ? "se" : "move";
      onChange(
        item.id,
        dragRect(item, grip, arrow[0], arrow[1], { page, square: item.square }).rect,
      );
    } else if ((event.key === "Delete" || event.key === "Backspace") && onRemove) {
      event.preventDefault();
      onRemove(item.id);
    } else if (event.key === "Escape") {
      onSelect(null);
      (event.currentTarget as HTMLElement).blur();
    }
  };

  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      aria-describedby={hint}
      data-slot="stage"
      className={cn("relative w-full touch-none overflow-visible select-none", className)}
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget ||
          !(event.target as Element).closest("[data-stage-item]")
        ) {
          onSelect(null);
        }
      }}
    >
      <span id={hint} className="sr-only">
        {t("ui.stageHint")}
      </span>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">{children}</div>
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <div
            key={item.id}
            data-stage-item
            role="button"
            tabIndex={0}
            aria-label={item.label}
            aria-pressed={active}
            className={cn(
              "absolute cursor-move outline-1 outline-transparent outline-dashed hover:outline-primary/50 focus-visible:outline-2 focus-visible:outline-ring",
              active && "z-10 outline-primary outline-solid",
            )}
            style={{
              left: percent(item.x, width),
              top: percent(item.y, height),
              width: percent(item.w, width),
              height: percent(item.h, height),
            }}
            onPointerDown={(event) => start(event, item, "move")}
            onFocus={() => {
              if (!active) onSelect(item.id);
            }}
            onKeyDown={(event) => key(event, item)}
          >
            <div className="pointer-events-none size-full">{renderItem(item)}</div>
            {active &&
              GRIPS.filter(({ grip }) => !item.square || grip.length === 2).map(
                ({ grip, className: place }) => (
                  <span
                    key={grip}
                    aria-hidden
                    className={cn(
                      "absolute size-3 rounded-full border border-primary bg-background shadow-sm",
                      place,
                    )}
                    onPointerDown={(event) => start(event, item, grip)}
                  />
                ),
              )}
          </div>
        );
      })}
      {guides.x.map((x) => (
        <span
          key={`x${x}`}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: percent(x, width) }}
        />
      ))}
      {guides.y.map((y) => (
        <span
          key={`y${y}`}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-px bg-primary"
          style={{ top: percent(y, height) }}
        />
      ))}
    </div>
  );
}
