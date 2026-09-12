export type Tool =
  | "select"
  | "text"
  | "arrow"
  | "ellipse"
  | "rectangle"
  | "pen"
  | "penArrow"
  | "highlight"
  | "blur"
  | "step"
  | "eraser"
  | "eyedropper";

export type DrawTool = Exclude<Tool, "select" | "eraser" | "eyedropper">;

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface Point {
  x: number;
  y: number;
}

export type ElementKind =
  | "text"
  | "arrow"
  | "ellipse"
  | "rectangle"
  | "pen"
  | "penArrow"
  | "highlight"
  | "blur"
  | "step";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se" | "e";

interface BaseElement {
  id: number;
  color: string;
  size: number;
}

export interface TextElement extends BaseElement {
  kind: "text";
  x: number;
  y: number;
  text: string;
  width?: number;
}

export interface ArrowElement extends BaseElement {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ShapeElement extends BaseElement {
  kind: "ellipse" | "rectangle" | "blur";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PenElement extends BaseElement {
  kind: "pen" | "highlight" | "penArrow";
  points: Point[];
}

export interface StepElement extends BaseElement {
  kind: "step";
  x: number;
  y: number;
  stepNumber: number;
}

export type Element =
  | TextElement
  | ArrowElement
  | ShapeElement
  | PenElement
  | StepElement;

let nextId = 1;

export function newId(): number {
  return nextId++;
}

export function nextStepNumber(els: Element[]): number {
  let max = 0;
  for (const e of els) {
    if (e.kind === "step" && e.stepNumber > max) max = e.stepNumber;
  }
  return max + 1;
}

export function compactStepNumbers(els: Element[]): Element[] {
  let n = 0;
  return els.map((e) => {
    if (e.kind !== "step") return e;
    n++;
    return { ...e, stepNumber: n };
  });
}

function srgbChannel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n) || hex.length !== 7) return 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function stepGlyphAndRing(color: string): { glyph: string; ring: string } {
  const dark = relativeLuminance(color) > 0.45;
  return dark ? { glyph: "#0f172a", ring: "#0f172a" } : { glyph: "#ffffff", ring: "#ffffff" };
}

export const STEP_SIZE_MIN = 14;
export const STEP_SIZE_MAX = 72;
/** Fraction of digit `fontSize` used as SVG `y` (alphabetic baseline under
 *  the circle center). User units — WKWebView resolves `em` on `dy` against
 *  the inherited CSS font-size, so the glyph drifts up as the badge grows. */
export const STEP_DIGIT_BASELINE = 0.37;

export function stepBadgeAppearance(el: StepElement): {
  digits: number;
  r: number;
  fontSize: number;
  /** SVG `y` for the digit, in the same user units as `fontSize` (center). */
  textY: number;
  strokeWidth: number;
  glyph: string;
  ring: string;
} {
  const digits = Math.max(1, String(el.stepNumber).length);
  const r = el.size * 0.8 * (1 + 0.32 * (digits - 1));
  const fontSize = el.size * 0.85;
  const strokeWidth = Math.max(2, el.size * 0.1);
  const { glyph, ring } = stepGlyphAndRing(el.color);
  return {
    digits,
    r,
    fontSize,
    textY: fontSize * STEP_DIGIT_BASELINE,
    strokeWidth,
    glyph,
    ring,
  };
}

const TEXT_WIDTH_FACTOR = 0.58;

export const TEXT_LINE_HEIGHT = 1;
export const TEXT_FONT_WEIGHT = 600;
export const TEXT_FONT_FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif";
export const TEXT_PAD_X = 10;
export const TEXT_PAD_Y = 6;

export function textLineAdvance(fontSize: number): number {
  return fontSize * TEXT_LINE_HEIGHT;
}

/** Marker box height: wrapped lines plus the CSS padding on TextMarker. */
export function textBoxHeight(text: string, fontSize: number, boxWidth?: number): number {
  const lines = wrapTextLines(text, fontSize, boxWidth);
  const content = Math.max(lines.length * textLineAdvance(fontSize), fontSize);
  return content + TEXT_PAD_Y * 2;
}

export function textContentMaxWidth(x: number, canvasW: number, boxWidth?: number): number {
  const remaining = Math.max(1, canvasW - x);
  if (boxWidth != null && boxWidth > 0) {
    return Math.max(1, Math.min(boxWidth, remaining));
  }
  return remaining;
}

export function textDisplayWidth(
  measuredW: number,
  x: number,
  canvasW: number,
  boxWidth?: number,
): number {
  const remaining = Math.max(1, canvasW - x);
  if (boxWidth != null && boxWidth > 0) {
    return Math.max(1, Math.min(boxWidth, remaining));
  }
  const MIN_PLACEHOLDER = 80;
  const hug = Math.max(MIN_PLACEHOLDER, measuredW);
  return Math.max(1, Math.min(hug, remaining));
}

export const TEXT_MIN_WIDTH = 140;

/**
 * Calculates initial bounds for a text marker so it receives at least minWidth,
 * while ensuring its right edge does not exceed canvasW (shifting x left if needed).
 */
export function clampTextPlacement(
  p: Point,
  canvasW: number,
  minWidth = TEXT_MIN_WIDTH,
): { x: number; y: number; width: number } {
  const width = Math.max(1, Math.min(minWidth, canvasW));
  const x = Math.max(0, Math.min(p.x, canvasW - width));
  return { x, y: Math.max(0, p.y), width };
}

export function wrapTextLines(text: string, fontSize: number, maxWidth?: number): string[] {
  const rawLines = text.split("\n");
  if (!maxWidth || maxWidth <= 0) return rawLines;

  const charW = fontSize * TEXT_WIDTH_FACTOR;
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));

  const result: string[] = [];
  for (const line of rawLines) {
    if (line.length <= maxChars) {
      result.push(line);
    } else {
      let lineBuf = "";
      const words = line.split(" ");
      for (const w of words) {
        if ((lineBuf ? lineBuf + " " + w : w).length <= maxChars) {
          lineBuf = lineBuf ? lineBuf + " " + w : w;
        } else {
          if (lineBuf) result.push(lineBuf);
          if (w.length > maxChars) {
            let remaining = w;
            while (remaining.length > maxChars) {
              result.push(remaining.slice(0, maxChars));
              remaining = remaining.slice(maxChars);
            }
            lineBuf = remaining;
          } else {
            lineBuf = w;
          }
        }
      }
      if (lineBuf) result.push(lineBuf);
    }
  }
  return result;
}

export function normalizeRect(a: Point, b: Point, square = false): Rect {
  let x = Math.min(a.x, b.x);
  let y = Math.min(a.y, b.y);
  let width = Math.abs(a.x - b.x);
  let height = Math.abs(a.y - b.y);
  if (square) {
    const side = Math.max(width, height);
    width = side;
    height = side;
    if (b.x < a.x) x = a.x - side;
    if (b.y < a.y) y = a.y - side;
  }
  return { x, y, width, height };
}

export function bbox(e: Element): Rect {
  switch (e.kind) {
    case "text": {
      const lines = wrapTextLines(e.text, e.size, e.width);
      const maxLen = lines.reduce((max, l) => Math.max(max, l.length), 0);
      const computedW = Math.max(e.size, (maxLen || 1) * e.size * TEXT_WIDTH_FACTOR);
      const MIN_TEXT_W = 80;
      const width = e.width && e.width > 0 ? Math.max(e.width, computedW) : Math.max(computedW, MIN_TEXT_W);
      return {
        x: e.x,
        y: e.y,
        width,
        height: textBoxHeight(e.text, e.size, e.width),
      };
    }
    case "step": {
      const { r, strokeWidth } = stepBadgeAppearance(e);
      const extent = r + strokeWidth / 2;
      return {
        x: e.x - extent,
        y: e.y - extent,
        width: extent * 2,
        height: extent * 2,
      };
    }
    case "arrow":
      return {
        x: Math.min(e.x1, e.x2),
        y: Math.min(e.y1, e.y2),
        width: Math.abs(e.x2 - e.x1),
        height: Math.abs(e.y2 - e.y1),
      };
    case "ellipse":
    case "rectangle":
    case "blur":
      return { x: e.x, y: e.y, width: e.width, height: e.height };
    case "pen":
    case "penArrow":
    case "highlight": {
      if (e.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
    }
  }
}

export function createElement(
  kind: DrawTool,
  start: Point,
  color: string,
  size: number,
  stepNumber = 1,
  width?: number,
): Element {
  const id = newId();
  switch (kind) {
    case "text":
      return { id, kind: "text", x: start.x, y: start.y, text: "", color, size, width };
    case "step":
      return {
        id,
        kind: "step",
        x: start.x,
        y: start.y,
        stepNumber,
        color,
        size,
      };
    case "arrow":
      return {
        id,
        kind: "arrow",
        x1: start.x,
        y1: start.y,
        x2: start.x,
        y2: start.y,
        color,
        size,
      };
    case "ellipse":
    case "rectangle":
    case "blur":
      return {
        id,
        kind,
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
        color,
        size,
      };
    case "pen":
    case "penArrow":
    case "highlight":
      return { id, kind, points: [start], color, size };
  }
}

export function extendElement(e: Element, start: Point, current: Point, square = false): Element {
  switch (e.kind) {
    case "text":
    case "step":
      return e;
    case "arrow":
      return { ...e, x2: current.x, y2: current.y };
    case "ellipse":
    case "rectangle": {
      const r = normalizeRect(start, current, square);
      return { ...e, ...r };
    }
    case "blur": {
      const r = normalizeRect(start, current);
      return { ...e, ...r };
    }
    case "pen":
    case "penArrow":
    case "highlight":
      return { ...e, points: [...e.points, current] };
  }
}

export function moveElement(e: Element, dx: number, dy: number): Element {
  switch (e.kind) {
    case "text":
    case "step":
      return { ...e, x: e.x + dx, y: e.y + dy };
    case "arrow":
      return {
        ...e,
        x1: e.x1 + dx,
        y1: e.y1 + dy,
        x2: e.x2 + dx,
        y2: e.y2 + dy,
      };
    case "ellipse":
    case "rectangle":
    case "blur":
      return { ...e, x: e.x + dx, y: e.y + dy };
    case "pen":
    case "penArrow":
    case "highlight":
      return {
        ...e,
        points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
  }
}

export function resizeElement(e: ShapeElement, handle: ResizeHandle, dx: number, dy: number, canvasW?: number, square?: boolean): ShapeElement;
export function resizeElement(e: TextElement, handle: ResizeHandle, dx: number, dy: number, canvasW?: number, square?: boolean): TextElement;
export function resizeElement(e: StepElement, handle: ResizeHandle, dx: number, dy: number, canvasW?: number, square?: boolean): StepElement;
export function resizeElement(e: Element, handle: ResizeHandle, dx: number, dy: number, canvasW?: number, square?: boolean): Element;
export function resizeElement(
  e: Element,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  canvasW = 9999,
  square = false,
): Element {
  if (e.kind === "step") {
    if (handle !== "nw" && handle !== "ne" && handle !== "sw" && handle !== "se") return e;
    const { r, strokeWidth } = stepBadgeAppearance(e);
    const extent = r + strokeWidth / 2;
    const sx = handle === "nw" || handle === "sw" ? -1 : 1;
    const sy = handle === "nw" || handle === "ne" ? -1 : 1;
    const origDist = Math.hypot(sx * extent, sy * extent);
    const newDist = Math.hypot(sx * extent + dx, sy * extent + dy);
    if (origDist < 1e-6) return e;
    const size = Math.max(
      STEP_SIZE_MIN,
      Math.min(STEP_SIZE_MAX, Math.round(e.size * (newDist / origDist))),
    );
    return { ...e, size };
  }
  if (e.kind === "text") {
    if (handle !== "nw" && handle !== "ne" && handle !== "sw" && handle !== "se" && handle !== "e") return e;
    const oldW = e.width ?? 120;
    let width = oldW;
    let x = e.x;
    let y = e.y;
    let size = e.size;
    if (handle === "nw" || handle === "sw") {
      const nextW = Math.max(70, oldW - dx);
      // Recompute remaining after the provisional x shift so a west drag
      // near the right edge can grow to fill canvasW (remaining stale fix).
      const xProv = e.x + (oldW - nextW);
      const remainingAfter = textContentMaxWidth(xProv, canvasW, undefined);
      const clampedW = Math.min(nextW, remainingAfter);
      const dxClamped = oldW - clampedW;
      x = e.x + dxClamped;
      width = clampedW;
    } else {
      const remaining = textContentMaxWidth(e.x, canvasW, undefined);
      const nextW = Math.max(70, oldW + dx);
      width = Math.min(nextW, remaining);
    }
    const north = handle === "nw" || handle === "ne";
    const south = handle === "se" || handle === "sw";
    const oldBottom = e.y + bbox(e).height;
    if (south) {
      size = Math.max(10, Math.min(72, Math.round(size + dy / 4)));
    } else if (north) {
      size = Math.max(10, Math.min(72, Math.round(size - dy / 4)));
      const newH = bbox({ ...e, width, size }).height;
      y = oldBottom - newH;
    }
    return { ...e, x, y, width, size };
  }
  if (e.kind === "ellipse" || e.kind === "rectangle" || e.kind === "blur") {
    let { x, y, width, height } = e;
    switch (handle) {
      case "nw":
        x += dx;
        y += dy;
        width -= dx;
        height -= dy;
        break;
      case "ne":
        y += dy;
        width += dx;
        height -= dy;
        break;
      case "sw":
        x += dx;
        width -= dx;
        height += dy;
        break;
      case "se":
        width += dx;
        height += dy;
        break;
      case "e":
        width += dx;
        break;
    }
    if (width < 1) width = 1;
    if (height < 1) height = 1;
    if (square && (e.kind === "ellipse" || e.kind === "rectangle")) {
      const side = Math.max(width, height);
      const right = e.x + e.width;
      const bottom = e.y + e.height;
      switch (handle) {
        case "se":
          return { ...e, x: e.x, y: e.y, width: side, height: side };
        case "nw":
          return { ...e, x: right - side, y: bottom - side, width: side, height: side };
        case "ne":
          return { ...e, x: e.x, y: bottom - side, width: side, height: side };
        case "sw":
          return { ...e, x: right - side, y: e.y, width: side, height: side };
        default:
          break;
      }
    }
    return { ...e, x, y, width, height };
  }
  return e;
}

export function isTiny(e: Element): boolean {
  const b = bbox(e);
  if (e.kind === "text") return false;
  if (e.kind === "step") return false;
  if (e.kind === "arrow") return Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < 4;
  if (e.kind === "highlight") return e.points.length < 2;
  if (e.kind === "pen" || e.kind === "penArrow") return e.points.length < 1;
  return b.width < 4 && b.height < 4;
}

/** Pen/pen-arrow taps and very short strokes: keep the mark, hide delete chrome. */
export const COMPACT_INK_PX = 8;

export function isCompactInk(e: Element): boolean {
  if (e.kind !== "pen" && e.kind !== "penArrow" && e.kind !== "highlight") return false;
  if ((e.kind === "pen" || e.kind === "penArrow") && e.points.length < 2) return true;
  const b = bbox(e);
  return b.width < COMPACT_INK_PX && b.height < COMPACT_INK_PX;
}

/** SVG polylines skip a one-point path; nudge so round linecaps draw a dot. */
const STROKE_DOT_NUDGE = 0.01;

export function drawableStrokePoints(points: Point[]): Point[] {
  if (points.length !== 1) return points;
  const p = points[0];
  return [p, { x: p.x + STROKE_DOT_NUDGE, y: p.y }];
}

export function hitTest(elements: Element[], p: Point): Element | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    const b = bbox(e);
    const pad = Math.max(6, e.size / 2);
    if (
      p.x >= b.x - pad &&
      p.x <= b.x + b.width + pad &&
      p.y >= b.y - pad &&
      p.y <= b.y + b.height + pad
    ) {
      return e;
    }
  }
  return null;
}

export function sweepErasePoints(last: Point, current: Point): Point[] {
  return [current, { x: (last.x + current.x) / 2, y: (last.y + current.y) / 2 }];
}

const ARROW_HEAD_SPREAD = Math.PI / 5.5;

// Arrival baseline (px) for penArrow head aiming: spans several pointer
// samples to beat lift jitter, short enough to follow the end bend.
const PEN_ARROW_AIM_BASELINE = 4;

function arrowHeadGeometry(el: ArrowElement): {
  angle: number;
  headLen: number;
  tip: Point;
  p1: Point;
  p2: Point;
} {
  const dx = el.x2 - el.x1;
  const dy = el.y2 - el.y1;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(12, el.size * 3.2);
  const tip = { x: el.x2, y: el.y2 };

  const p1 = {
    x: el.x2 - headLen * Math.cos(angle - ARROW_HEAD_SPREAD),
    y: el.y2 - headLen * Math.sin(angle - ARROW_HEAD_SPREAD),
  };
  const p2 = {
    x: el.x2 - headLen * Math.cos(angle + ARROW_HEAD_SPREAD),
    y: el.y2 - headLen * Math.sin(angle + ARROW_HEAD_SPREAD),
  };

  return { angle, headLen, tip, p1, p2 };
}

export function arrowHeadPoints(el: ArrowElement): string {
  const { tip, p1, p2 } = arrowHeadGeometry(el);

  return `${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

export function arrowShaftEnd(el: ArrowElement): Point {
  const { angle, p1, p2 } = arrowHeadGeometry(el);
  const base = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  // Overlap slightly into the head so antialiasing leaves no gap at the
  // joint. Stays inside the triangle: with D = headLen*cos(spread) - overlap
  // the axial distance from the tip, D * sin(spread) is always wider than
  // the round cap radius (size / 2).
  const overlap = el.size * 0.3;
  return {
    x: base.x + Math.cos(angle) * overlap,
    y: base.y + Math.sin(angle) * overlap,
  };
}

export function penArrowHead(el: PenElement): {
  tip: Point;
  shaftEnd: Point;
  points: Point[];
  headPoints: string;
} | null {
  const pts = el.points;
  if (pts.length < 2) return null;
  const tip = pts[pts.length - 1];
  // Aim along the arrival direction over a short baseline (beats lift jitter,
  // follows the end bend), then straighten the rendered tail over the head
  // span: raw wobble vertices inside the triangle let the thick round shaft
  // spill past the triangle edges ("line poking out"). The tail A->shaftEnd
  // is axis-collinear, so the joint is perfect by the same construction as a
  // straight arrow. Stored points stay raw (bbox/hitTest/move unaffected).
  // headLen mirrors the head-sizing rule in arrowHeadGeometry.
  // Mirrors the head-sizing rule in arrowHeadGeometry.
  const headLen = Math.max(12, el.size * 3.2);
  let acc = 0;
  let j = pts.length - 1;
  let arrivalBase: Point | null = null;
  let cutIndex = 0;
  while (j > 0) {
    acc += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
    j--;
    if (arrivalBase === null && acc >= PEN_ARROW_AIM_BASELINE) arrivalBase = pts[j];
    if (acc >= headLen) {
      cutIndex = j;
      break;
    }
  }
  const base = arrivalBase ?? pts[0];
  if (base.x === tip.x && base.y === tip.y) return null;
  const angle = Math.atan2(tip.y - base.y, tip.x - base.x);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  // Only the direction feeds the head math below; the length is arbitrary.
  const K = 10;
  const arrow: ArrowElement = {
    id: el.id, kind: "arrow",
    x1: tip.x - K * dir.x, y1: tip.y - K * dir.y,
    x2: tip.x, y2: tip.y,
    color: el.color, size: el.size,
  };
  const shaftEnd = arrowShaftEnd(arrow);
  const tailStart = { x: tip.x - headLen * dir.x, y: tip.y - headLen * dir.y };
  return {
    tip, shaftEnd,
    points: [...pts.slice(0, cutIndex + 1), tailStart, shaftEnd],
    headPoints: arrowHeadPoints(arrow),
  };
}

