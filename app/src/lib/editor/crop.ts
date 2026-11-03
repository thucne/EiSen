import type { Point, Rect, ResizeHandle } from "./elements";
import { cornerHandles, handleAt } from "./pointer";

/** Same floor as the overlay selection, so a crop is never a stray click. */
export const MIN_CROP_SIZE = 10;

function clampPoint(p: Point, canvasW: number, canvasH: number): Point {
  return {
    x: Math.round(Math.max(0, Math.min(p.x, canvasW))),
    y: Math.round(Math.max(0, Math.min(p.y, canvasH))),
  };
}

export function cropFromDrag(a: Point, b: Point, canvasW: number, canvasH: number): Rect {
  const p = clampPoint(a, canvasW, canvasH);
  const q = clampPoint(b, canvasW, canvasH);
  return {
    x: Math.min(p.x, q.x),
    y: Math.min(p.y, q.y),
    width: Math.abs(p.x - q.x),
    height: Math.abs(p.y - q.y),
  };
}

export function moveCrop(r: Rect, dx: number, dy: number, canvasW: number, canvasH: number): Rect {
  return {
    ...r,
    x: Math.round(Math.max(0, Math.min(r.x + dx, canvasW - r.width))),
    y: Math.round(Math.max(0, Math.min(r.y + dy, canvasH - r.height))),
  };
}

/** Drags one corner against the opposite one, which stays fixed. */
export function resizeCrop(
  r: Rect,
  handle: ResizeHandle,
  p: Point,
  canvasW: number,
  canvasH: number,
): Rect {
  const anchor = {
    x: handle === "nw" || handle === "sw" ? r.x + r.width : r.x,
    y: handle === "nw" || handle === "ne" ? r.y + r.height : r.y,
  };
  return cropFromDrag(anchor, p, canvasW, canvasH);
}

export function isValidCrop(r: Rect): boolean {
  return r.width >= MIN_CROP_SIZE && r.height >= MIN_CROP_SIZE;
}

/** The stored form of a crop: a rect covering the whole image means no crop. */
export function storedCrop(r: Rect, canvasW: number, canvasH: number): Rect | null {
  return r.x <= 0 && r.y <= 0 && r.width >= canvasW && r.height >= canvasH ? null : r;
}

export function cropGesture(r: Rect, p: Point): ResizeHandle | "move" | "draw" {
  const handle = handleAt(cornerHandles(r), p);
  if (handle) return handle;
  const inside = p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  return inside ? "move" : "draw";
}
