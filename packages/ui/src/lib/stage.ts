export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which edges a drag moves: "move" all of them, otherwise compass handles. */
export type StageGrip = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface StageGuides {
  x: number[];
  y: number[];
}

const MIN = 2;

function round(value: number): number {
  return Math.round(value * 2) / 2;
}

/** Lines worth snapping to: the page's edges and middle, and every other item's. */
export function stageTargets(
  page: { width: number; height: number },
  others: readonly StageRect[],
): StageGuides {
  return {
    x: [0, page.width / 2, page.width, ...others.flatMap((r) => [r.x, r.x + r.w / 2, r.x + r.w])],
    y: [0, page.height / 2, page.height, ...others.flatMap((r) => [r.y, r.y + r.h / 2, r.y + r.h])],
  };
}

function nearest(edges: number[], targets: number[], threshold: number) {
  let best: { offset: number; line: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const offset = target - edge;
      if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) {
        best = { offset, line: target };
      }
    }
  }
  return best;
}

/** Applies a drag of (dx, dy) to `start` with `grip`, snapping moved edges to `targets`
 * within `threshold`, keeping it on the page and at least a little big. */
export function dragRect(
  start: StageRect,
  grip: StageGrip,
  dx: number,
  dy: number,
  options: {
    page: { width: number; height: number };
    targets?: StageGuides;
    threshold?: number;
    square?: boolean;
  },
): { rect: StageRect; guides: StageGuides } {
  const { page, targets, threshold = 0, square = false } = options;
  const guides: StageGuides = { x: [], y: [] };
  if (grip === "move") {
    let x = Math.min(Math.max(start.x + dx, 0), Math.max(0, page.width - start.w));
    let y = Math.min(Math.max(start.y + dy, 0), Math.max(0, page.height - start.h));
    if (targets) {
      const sx = nearest([x, x + start.w / 2, x + start.w], targets.x, threshold);
      const sy = nearest([y, y + start.h / 2, y + start.h], targets.y, threshold);
      if (sx) {
        x += sx.offset;
        guides.x.push(sx.line);
      }
      if (sy) {
        y += sy.offset;
        guides.y.push(sy.line);
      }
    }
    return { rect: { ...start, x: round(x), y: round(y) }, guides };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const west = grip.includes("w");
  const east = grip.includes("e");
  const north = grip.includes("n");
  const south = grip.includes("s");
  if (west) left = Math.min(Math.max(0, left + dx), right - MIN);
  if (east) right = Math.max(Math.min(page.width, right + dx), left + MIN);
  if (north) top = Math.min(Math.max(0, top + dy), bottom - MIN);
  if (south) bottom = Math.max(Math.min(page.height, bottom + dy), top + MIN);
  if (targets && !square) {
    const sx = nearest([west ? left : right], targets.x, threshold);
    if (sx && (west || east)) {
      if (west) left += sx.offset;
      else right += sx.offset;
      guides.x.push(sx.line);
    }
    const sy = nearest([north ? top : bottom], targets.y, threshold);
    if (sy && (north || south)) {
      if (north) top += sy.offset;
      else bottom += sy.offset;
      guides.y.push(sy.line);
    }
  }
  let w = right - left;
  let h = bottom - top;
  if (square) {
    const side = Math.max(
      MIN,
      (west || east) && (north || south) ? Math.max(w, h) : west || east ? w : h,
    );
    const fits = Math.min(side, page.width, page.height);
    w = fits;
    h = fits;
    if (west) left = right - w;
    if (north) top = bottom - h;
    left = Math.min(Math.max(0, left), page.width - w);
    top = Math.min(Math.max(0, top), page.height - h);
  }
  return { rect: { x: round(left), y: round(top), w: round(w), h: round(h) }, guides };
}
