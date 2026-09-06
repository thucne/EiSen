import { derived, get, writable } from "svelte/store";
import {
  compactStepNumbers,
  createElement,
  extendElement,
  isCompactInk,
  isTiny,
  moveElement,
  nextStepNumber,
  resizeElement,
  type DrawTool,
  type Element,
  type Point,
  type ResizeHandle,
  type Tool,
} from "./elements";

export const tool = writable<Tool>("select");
export const color = writable("#ef4444");
export const strokeSize = writable(4);
export const elements = writable<Element[]>([]);
export const selectedId = writable<number | null>(null);
export const editingId = writable<number | null>(null);

const undoStack = writable<Element[][]>([]);
const redoStack = writable<Element[][]>([]);

export const canUndo = derived(undoStack, (s) => s.length > 0);
export const canRedo = derived(redoStack, (s) => s.length > 0);

const DRAW_SIZES: Record<DrawTool, number> = {
  text: 18,
  step: 24,
  arrow: 4,
  ellipse: 4,
  rectangle: 4,
  pen: 4,
  penArrow: 4,
  highlight: 20,
  blur: 4,
};

let anchor: Point | null = null;
let moveStart: Point | null = null;
let dragOriginal: Element | null = null;
let resizeHandle: ResizeHandle | null = null;
let resizeOriginal: Element | null = null;

export function getElements(): Element[] {
  return get(elements);
}

export function setTool(t: Tool): void {
  tool.set(t);
  if (t === "text" || t === "step" || t === "highlight") {
    strokeSize.set(DRAW_SIZES[t]);
  } else if (t !== "select" && t !== "eraser" && t !== "eyedropper") {
    strokeSize.set(DRAW_SIZES[t]);
  }
}

export function setColor(c: string): void {
  color.set(c);
  const id = get(selectedId);
  if (id == null) return;
  snapshot();
  patch(id, (e) => ({ ...e, color: c }));
}

export function setStrokeSize(n: number): void {
  strokeSize.set(n);
  const t = get(tool);
  if (t in DRAW_SIZES) {
    DRAW_SIZES[t as DrawTool] = n;
  }
  const id = get(selectedId);
  if (id == null) return;
  const selected = getElements().find((e) => e.id === id);
  if (selected?.kind === "step") return;
  snapshot();
  patch(id, (e) => ({ ...e, size: n }));
}

export function select(id: number | null): void {
  selectedId.set(id);
  if (id != null && get(editingId) != null) editingId.set(null);
}

function snapshot(): void {
  undoStack.update((s) => [...s, get(elements)]);
  redoStack.set([]);
}

function consumeSnapshot(): void {
  undoStack.update((s) => s.slice(0, -1));
}

function removeSilent(id: number): void {
  elements.update((a) => a.filter((x) => x.id !== id));
  if (get(selectedId) === id) selectedId.set(null);
  if (get(editingId) === id) editingId.set(null);
}

function patch(id: number, fn: (e: Element) => Element): void {
  elements.update((arr) => arr.map((e) => (e.id === id ? fn(e) : e)));
}

function resequenceSteps(): void {
  elements.update((arr) => compactStepNumbers(arr));
}

export function beginDraw(kind: DrawTool, p: Point): number {
  snapshot();
  const e = createElement(
    kind,
    p,
    get(color),
    get(strokeSize),
    kind === "step" ? nextStepNumber(getElements()) : 1,
  );
  anchor = p;
  elements.update((arr) => [...arr, e]);
  selectedId.set(e.id);
  if (kind === "text") editingId.set(e.id);
  return e.id;
}

export function extendDraw(id: number, p: Point, square = false): void {
  const a = anchor;
  if (!a) return;
  patch(id, (e) => extendElement(e, a, p, square));
}

export function endDraw(id: number): void {
  anchor = null;
  if (get(editingId) === id) return;
  const e = getElements().find((x) => x.id === id);
  if (e && isTiny(e)) {
    removeSilent(id);
    consumeSnapshot();
    return;
  }
  if (e && (e.kind === "pen" || e.kind === "penArrow") && isCompactInk(e)) {
    selectedId.set(null);
  }
}

export function beginTextEdit(id: number): void {
  snapshot();
  editingId.set(id);
}

export function setText(id: number, text: string): void {
  patch(id, (e) => (e.kind === "text" ? { ...e, text } : e));
}

export function setTextWidth(id: number, width: number): void {
  patch(id, (e) => (e.kind === "text" ? { ...e, width } : e));
}

export function endTextEdit(): void {
  const id = get(editingId);
  editingId.set(null);
  if (id == null) return;
  const e = getElements().find((x) => x.id === id);
  if (e && e.kind === "text" && e.text.trim() === "") {
    removeSilent(id);
    consumeSnapshot();
  }
}

export function beginMove(id: number, start: Point): void {
  snapshot();
  selectedId.set(id);
  moveStart = start;
  dragOriginal = getElements().find((e) => e.id === id) ?? null;
}

export function moveTo(id: number, p: Point): void {
  const original = dragOriginal;
  const start = moveStart;
  if (!original || !start) return;
  patch(id, () => moveElement(original, p.x - start.x, p.y - start.y));
}

export function endMove(): void {
  moveStart = null;
  dragOriginal = null;
}

/** Abandon a move that never changed the element (click-to-edit). */
export function cancelMove(): void {
  if (dragOriginal) consumeSnapshot();
  moveStart = null;
  dragOriginal = null;
}

/** Offsets the selected element by (dx, dy) as one undoable step. No-op when
 *  nothing is selected. Used by the arrow-key bindings. */
export function nudgeSelection(dx: number, dy: number): void {
  const id = get(selectedId);
  if (id == null) return;
  snapshot();
  patch(id, (e) => moveElement(e, dx, dy));
}

export function beginResize(id: number, handle: ResizeHandle, start: Point): void {
  snapshot();
  selectedId.set(id);
  resizeHandle = handle;
  moveStart = start;
  const e = getElements().find((x) => x.id === id);
  resizeOriginal =
    e && (e.kind === "ellipse" || e.kind === "rectangle" || e.kind === "blur" || e.kind === "text" || e.kind === "step")
      ? e
      : null;
}

export function resizeTo(id: number, p: Point, canvasW?: number, square = false): void {
  const original = resizeOriginal;
  const handle = resizeHandle;
  const start = moveStart;
  if (!original || !handle || !start) return;
  const next = resizeElement(original, handle, p.x - start.x, p.y - start.y, canvasW, square);
  if (original.kind === "step" && next.kind === "step") {
    DRAW_SIZES.step = next.size;
    if (get(tool) === "step") strokeSize.set(next.size);
    elements.update((a) => a.map((e) => (e.kind === "step" ? { ...e, size: next.size } : e)));
    return;
  }
  patch(id, () => next);
}

export function endResize(): void {
  resizeHandle = null;
  moveStart = null;
  resizeOriginal = null;
}

export function remove(id: number): void {
  snapshot();
  removeSilent(id);
  resequenceSteps();
}

export function removeLast(): void {
  const arr = getElements();
  const last = arr[arr.length - 1];
  if (last) remove(last.id);
}

let eraseActive = false;
let eraseCount = 0;

export function beginErase(): void {
  if (eraseActive) return;
  eraseActive = true;
  eraseCount = 0;
  snapshot();
}

export function eraseAt(id: number): void {
  if (!eraseActive) return;
  removeSilent(id);
  eraseCount++;
}

export function eraseLast(): void {
  if (!eraseActive) return;
  const arr = getElements();
  const last = arr[arr.length - 1];
  if (!last) return;
  removeSilent(last.id);
  eraseCount++;
}

export function endErase(): boolean {
  if (!eraseActive) return false;
  eraseActive = false;
  const had = eraseCount > 0;
  if (!had) consumeSnapshot();
  else resequenceSteps();
  eraseCount = 0;
  return had;
}

export function undo(): void {
  undoStack.update((stack) => {
    const previous = stack.pop();
    if (previous) {
      redoStack.update((s) => [...s, get(elements)]);
      elements.set(previous);
      selectedId.set(null);
      editingId.set(null);
    }
    return stack;
  });
}

export function redo(): void {
  redoStack.update((stack) => {
    const next = stack.pop();
    if (next) {
      undoStack.update((s) => [...s, get(elements)]);
      elements.set(next);
      selectedId.set(null);
      editingId.set(null);
    }
    return stack;
  });
}

export function reset(): void {
  elements.set([]);
  undoStack.set([]);
  redoStack.set([]);
  selectedId.set(null);
  editingId.set(null);
  tool.set("select");
  anchor = null;
  moveStart = null;
  dragOriginal = null;
  resizeHandle = null;
  resizeOriginal = null;
  eraseActive = false;
  eraseCount = 0;
}
