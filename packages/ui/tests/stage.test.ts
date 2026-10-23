import { expect, test } from "vite-plus/test";
import { dragRect, stageTargets } from "../src/lib/stage.ts";

const page = { width: 297, height: 210 };
const box = { x: 10, y: 10, w: 40, h: 20 };

test("moving stays on the page", () => {
  expect(dragRect(box, "move", -50, 500, { page }).rect).toEqual({ x: 0, y: 190, w: 40, h: 20 });
});

test("moving snaps the nearest edge or middle to a guide and shows it", () => {
  const targets = stageTargets(page, []);
  const { rect, guides } = dragRect(box, "move", 117.5, 0, { page, targets, threshold: 2 });
  expect(rect.x + rect.w / 2).toBe(148.5);
  expect(guides.x).toEqual([148.5]);
  expect(dragRect(box, "move", 30, 0, { page, targets, threshold: 2 }).guides.x).toEqual([]);
});

test("other items are guides too", () => {
  const targets = stageTargets(page, [{ x: 100, y: 100, w: 10, h: 10 }]);
  expect(dragRect(box, "move", 0, 89, { page, targets, threshold: 2 }).rect.y).toBe(100);
});

test("resizing moves only the grabbed edges and never goes below the minimum", () => {
  expect(dragRect(box, "e", 10, 10, { page }).rect).toEqual({ x: 10, y: 10, w: 50, h: 20 });
  expect(dragRect(box, "nw", -5, -5, { page }).rect).toEqual({ x: 5, y: 5, w: 45, h: 25 });
  expect(dragRect(box, "w", 100, 0, { page }).rect.w).toBe(2);
});

test("square items stay square from a corner", () => {
  const { rect } = dragRect({ x: 10, y: 10, w: 20, h: 20 }, "se", 10, 2, { page, square: true });
  expect(rect).toEqual({ x: 10, y: 10, w: 30, h: 30 });
});
