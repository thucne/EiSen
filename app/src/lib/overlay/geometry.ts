export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ToolbarPosition {
  x: number;
  y: number;
  inside: boolean;
}

export const DEFAULT_TOOLBAR_H = 40;
export const DEFAULT_GAP = 16;

/**
 * Computes the normalized bounding rectangle between two points.
 * Supports aspect ratio locking (1:1 square) when `square` is true.
 */
export function selectionRect(p1: Point, p2: Point, square: boolean = false): Rect {
  let left = Math.min(p1.x, p2.x);
  let top = Math.min(p1.y, p2.y);
  let width = Math.abs(p1.x - p2.x);
  let height = Math.abs(p1.y - p2.y);

  if (square) {
    const side = Math.max(width, height);
    width = side;
    height = side;
    if (p2.x < p1.x) left = p1.x - side;
    if (p2.y < p1.y) top = p1.y - side;
  }

  return { left, top, width, height };
}

/**
 * Computes responsive viewport-safe floating toolbar position.
 * Prioritizes rendering below selection, flips above when colliding with bottom,
 * and falls back to rendering inside selection if neither outside space fits.
 */
export function computeToolbarPosition(
  rect: Rect,
  viewport: Viewport,
  measuredToolbarWidth: number = 300,
  toolbarHeight: number = DEFAULT_TOOLBAR_H,
  gap: number = DEFAULT_GAP,
): ToolbarPosition {
  const vw = viewport.width;
  const vh = viewport.height;
  const tw = measuredToolbarWidth + gap;

  // Preferred: right-aligned with selection, clamped within viewport bounds
  const preferredX = rect.left + rect.width - tw + gap;
  const clampedX = Math.min(vw - tw, Math.max(gap, preferredX));

  // 1. Try below selection
  const belowY = rect.top + rect.height + gap;
  if (belowY + toolbarHeight + gap <= vh) {
    return { x: clampedX, y: belowY, inside: false };
  }

  // 2. Try above selection
  const aboveY = rect.top - toolbarHeight - gap;
  if (aboveY >= gap * 2) {
    return { x: clampedX, y: aboveY, inside: false };
  }

  // 3. Fallback: render inside the selection near bottom-right
  const insideX = Math.min(rect.left + rect.width - tw, vw - tw);
  const insideY = Math.min(rect.top + rect.height - toolbarHeight - gap, vh - toolbarHeight - gap);

  return {
    x: Math.max(rect.left + gap, insideX),
    y: Math.max(rect.top + gap, insideY),
    inside: true,
  };
}

/**
 * Offsets a selection rectangle by (dx, dy), optionally clamping inside viewport bounds.
 */
export function shiftRect(rect: Rect, dx: number, dy: number, viewport?: Viewport): Rect {
  let left = rect.left + dx;
  let top = rect.top + dy;
  const width = rect.width;
  const height = rect.height;

  if (viewport) {
    left = Math.max(0, Math.min(viewport.width - width, left));
    top = Math.max(0, Math.min(viewport.height - height, top));
  }

  return { left, top, width, height };
}

export type Corner = "nw" | "ne" | "sw" | "se";

/** The corner diagonally opposite `corner`, which stays fixed while the
 *  dragged corner follows the pointer. */
export function oppositeCorner(rect: Rect, corner: Corner): Point {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  switch (corner) {
    case "nw": return { x: right, y: bottom };
    case "ne": return { x: rect.left, y: bottom };
    case "sw": return { x: right, y: rect.top };
    case "se": return { x: rect.left, y: rect.top };
  }
}
