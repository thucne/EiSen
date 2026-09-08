import type { ElementKind, Point, ResizeHandle, Tool } from "./elements";

export const HANDLE_R = 8;
export const DELETE_BUTTON_SIZE = 18;
export const TEXT_DRAG_THRESHOLD = 4;

const RESIZABLE: ReadonlySet<ElementKind> = new Set(["text", "ellipse", "rectangle", "blur", "step"]);

export function isResizableKind(kind: ElementKind | null | undefined): boolean {
  return kind != null && RESIZABLE.has(kind);
}

export function shouldBeginResize(opts: {
  handle: ResizeHandle | null;
  tool: Tool;
  targetKind: ElementKind | null | undefined;
}): boolean {
  if (!opts.handle || !isResizableKind(opts.targetKind)) return false;
  if (opts.tool === "eraser" || opts.tool === "eyedropper") return false;
  return true;
}

/** Size popover + [ ] apply to all drawable tools and selections (stroke, text, step). */
export function sizeControlVisible(
  tool: Tool,
  _selectedKind?: ElementKind | null,
): boolean {
  return tool !== "eraser" && tool !== "eyedropper";
}

export function textBodyIntent(tool: Tool): "move-or-edit" | null {
  if (tool === "select" || tool === "text") return "move-or-edit";
  return null;
}

/** Stamp tools: hit a same-kind element to move it; otherwise place new. */
export function stampHitIntent(
  tool: Tool,
  hitKind: ElementKind | null | undefined,
): "move" | "place" | null {
  if (tool === "text") return hitKind === "text" ? "move" : "place";
  if (tool === "step") return hitKind === "step" ? "move" : "place";
  return null;
}

export function textDragArmed(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= TEXT_DRAG_THRESHOLD;
}

/** Sit the delete control on the top border: horizontally centered, vertically on the stroke. */
export function deleteButtonPosition(
  box: { x: number; y: number; width: number },
  canvas: { w: number; h: number },
): { left: number; top: number } {
  const half = DELETE_BUTTON_SIZE / 2;
  const left = Math.max(2, Math.min(box.x + box.width / 2 - half, canvas.w - DELETE_BUTTON_SIZE - 2));
  const top = Math.max(2, Math.min(box.y - half, canvas.h - DELETE_BUTTON_SIZE - 2));
  return { left, top };
}

export function handleAt(
  handles: { x: number; y: number; handle: ResizeHandle }[],
  p: Point,
): ResizeHandle | null {
  for (const h of handles) {
    if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE_R + 4) return h.handle;
  }
  return null;
}

/** Corner handles sit on the box corners (no outward inset). */
export function cornerHandles(box: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  handle: ResizeHandle;
}[] {
  return [
    { x: box.x, y: box.y, handle: "nw" },
    { x: box.x + box.width, y: box.y, handle: "ne" },
    { x: box.x, y: box.y + box.height, handle: "sw" },
    { x: box.x + box.width, y: box.y + box.height, handle: "se" },
  ];
}
