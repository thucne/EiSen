import {
  TEXT_FONT_FAMILY,
  TEXT_FONT_WEIGHT,
  textContentMaxWidth,
  textDisplayWidth,
  textLineAdvance,
  type Element,
} from "./elements";

/** Nodes stripped from the cloned SVG before export rasterization.
 *  `.blur-group` marks live blur layers: they cannot survive Blob
 *  rasterization (external href) and are composited on the canvas instead.
 *  `foreignObject` holds live HTML text markers; WKWebView drops them in
 *  SVG Image rasterization, so export paints text via fillText instead. */
export const EXPORT_STRIP_SELECTOR =
  ".selection-box, .handle, .handle-html, .bg-base-image, .blur-group, foreignObject";

/** Must match the stdDeviation of #pixel-blur in editor/+page.svelte. */
export const BLUR_STD_DEVIATION = 8;

/** Canvas ctx.filter blur radius calibrated to visually match
 *  feGaussianBlur stdDeviation=8 (CSS blur(px) uses the same Gaussian
 *  parameter semantics, so px == stdDeviation). */
export const BLUR_EXPORT_RADIUS_PX = 8;

/** Largest capture scale we honor. Guards against a bogus scale factor
 *  allocating a multi-gigabyte canvas. */
export const MAX_EXPORT_SCALE = 4;

/** Normalizes a capture scale factor from the backend. Non-finite, missing,
 *  or <1 values collapse to 1 (never downscale the capture); values above
 *  MAX_EXPORT_SCALE are clamped. */
export function normalizeExportScale(scale: number | undefined | null): number {
  if (scale == null || !Number.isFinite(scale) || scale <= 1) return 1;
  return Math.min(scale, MAX_EXPORT_SCALE);
}

/** Pixel dimensions of the export canvas for a logical canvas at `scale`. */
export function exportPixelSize(
  canvasW: number,
  canvasH: number,
  scale: number | undefined | null,
): { width: number; height: number; scale: number } {
  const s = normalizeExportScale(scale);
  return {
    width: Math.max(1, Math.round(canvasW * s)),
    height: Math.max(1, Math.round(canvasH * s)),
    scale: s,
  };
}

/** Scales a rounded clip rect into export-pixel space. */
export function scaleClipRect(
  r: { x: number; y: number; width: number; height: number; rx: number },
  scale: number,
): { x: number; y: number; width: number; height: number; rx: number } {
  return {
    x: r.x * scale,
    y: r.y * scale,
    width: r.width * scale,
    height: r.height * scale,
    rx: r.rx * scale,
  };
}

export interface RoundedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

export function blurClipRects(elements: readonly Element[]): RoundedRect[] {
  return elements.flatMap((el) =>
    el.kind === "blur" && el.width >= 1 && el.height >= 1
      ? [{ x: el.x, y: el.y, width: el.width, height: el.height, rx: 4 }]
      : [],
  );
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  r: RoundedRect,
): void {
  const radius = Math.min(r.rx, r.width / 2, r.height / 2);
  ctx.moveTo(r.x + radius, r.y);
  ctx.arcTo(r.x + r.width, r.y, r.x + r.width, r.y + r.height, radius);
  ctx.arcTo(r.x + r.width, r.y + r.height, r.x, r.y + r.height, radius);
  ctx.arcTo(r.x, r.y + r.height, r.x, r.y, radius);
  ctx.arcTo(r.x, r.y, r.x + r.width, r.y, radius);
  ctx.closePath();
}

/** One step of the export z-order walk, mirroring live-view paint order
 *  ({#each $elements} in array order): a contiguous run of non-text non-blur
 *  shapes rasterized as one partial SVG layer, a text element painted with
 *  fillText, or a blur region composited from the base image. */
export type ExportSegment =
  | { kind: "run"; elements: Element[] }
  | { kind: "blur"; element: Element }
  | { kind: "text"; element: Element };

/** Splits elements so exports reproduce live-view occlusion: a run BEFORE a
 *  blur is hidden under it; text is its own step so fillText lands in z-order
 *  between surrounding shapes. */
export function segmentElementsForExport(
  elements: readonly Element[],
): ExportSegment[] {
  const segments: ExportSegment[] = [];
  let run: Element[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      segments.push({ kind: "run", elements: run });
      run = [];
    }
  };
  for (const el of elements) {
    if (el.kind === "blur") {
      flushRun();
      segments.push({ kind: "blur", element: el });
    } else if (el.kind === "text") {
      flushRun();
      segments.push({ kind: "text", element: el });
    } else {
      run.push(el);
    }
  }
  flushRun();
  return segments;
}

export function wrapTextByWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const rawLines = text.split("\n");
  if (maxWidth <= 0) return rawLines;

  const result: string[] = [];
  for (const line of rawLines) {
    if (measure(line) <= maxWidth) {
      result.push(line);
      continue;
    }
    let lineBuf = "";
    const words = line.split(" ");
    for (const w of words) {
      const candidate = lineBuf ? `${lineBuf} ${w}` : w;
      if (measure(candidate) <= maxWidth) {
        lineBuf = candidate;
      } else {
        if (lineBuf) result.push(lineBuf);
        if (measure(w) > maxWidth) {
          let remaining = w;
          while (remaining.length > 0 && measure(remaining) > maxWidth) {
            let take = 1;
            while (
              take < remaining.length &&
              measure(remaining.slice(0, take + 1)) <= maxWidth
            ) {
              take++;
            }
            result.push(remaining.slice(0, take));
            remaining = remaining.slice(take);
          }
          lineBuf = remaining;
        } else {
          lineBuf = w;
        }
      }
    }
    if (lineBuf) result.push(lineBuf);
  }
  return result;
}

/**
 * Live view renders text in a foreignObject whose width is
 * `textDisplayWidth(measuredScrollWidth, x, canvasW, el.width)` — a hug
 * (≈80px min or measured scrollWidth) clamped to remaining canvas. Export
 * previously used `textContentMaxWidth(x, canvasW, el.width)` which for
 * auto-width (el.width unset) expands to `canvasW - x` (remaining), so
 * short auto-width text wraps at different columns live vs export. Explicit
 * widths align (both clamp boxWidth to remaining). This function now mirrors
 * live by deriving a measured width from `ctx.measureText` and delegating to
 * `textDisplayWidth` for hug mode, so live/export wrapping matches.
 */
export function paintExportedText(
  ctx: CanvasRenderingContext2D,
  el: Element,
  canvasW: number,
  scale = 1,
): void {
  if (el.kind !== "text") return;
  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.font = `${TEXT_FONT_WEIGHT} ${el.size}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = el.color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  // Align export to live `textDisplayWidth` hug logic.
  let maxW: number;
  const tEl = el as Extract<Element, { kind: "text" }>;
  if (tEl.width != null && tEl.width > 0) {
    maxW = textContentMaxWidth(tEl.x, canvasW, tEl.width);
  } else {
    const measured = tEl.text
      .split("\n")
      .reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    // TextMarker horizontal padding is 10px each side → +20 to match live scrollWidth.
    maxW = textDisplayWidth(Math.ceil(measured + 20), tEl.x, canvasW, undefined);
  }
  const lines = wrapTextByWidth(el.text, maxW, (s) => ctx.measureText(s).width);
  let y = el.y;
  for (const line of lines) {
    ctx.fillText(line, el.x, y);
    y += textLineAdvance(el.size);
  }
  ctx.restore();
}

export function compositeBlurRegions(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  elements: readonly Element[],
  canvasW: number,
  canvasH: number,
  scale = 1,
): void {
  const supportsFilter = typeof ctx.filter === "string";
  for (const r of blurClipRects(elements)) {
    const sr = scaleClipRect(r, scale);
    ctx.save();
    ctx.beginPath();
    traceRoundedRect(ctx, sr);
    ctx.clip();
    if (supportsFilter) {
      ctx.filter = `blur(${BLUR_EXPORT_RADIUS_PX * scale}px)`;
      ctx.drawImage(source, 0, 0, canvasW * scale, canvasH * scale);
    } else {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
    }
    ctx.restore();
  }
}

export interface AnnotatedPngSource {
  /** Asset URL of the captured base image (already validated non-empty). */
  imageSrc: string;
  canvasW: number;
  canvasH: number;
  /** Live editor SVG whose annotation nodes get rasterized; null skips
   *  annotation rasterization and exports the bare base image. */
  svgEl: SVGSVGElement | null;
  /** Read at each z-order step so commits that land mid-render (e.g. a text
   *  edit ending during base-image decode) are honored exactly like the
   *  original in-page implementation. */
  getElements: () => readonly Element[];
  /** Capture scale factor from `CaptureSession.scale`; 1 means the capture
   *  is already 1:1 with logical points. */
  exportScale?: number;
}

/** Renders the annotated capture to PNG bytes: base image first, then the
 *  live SVG's annotation layers walked in element order with blur regions
 *  composited at their exact positions.
 *
 *  Invariant: element geometry stays in logical points. Only this function
 *  and the four drawing paths it calls know about pixels (logical × scale). */
export async function renderAnnotatedPng(
  src: AnnotatedPngSource,
): Promise<Uint8Array> {
  const { imageSrc, canvasW, canvasH } = src;
  const { width: pxW, height: pxH, scale } = exportPixelSize(
    canvasW,
    canvasH,
    src.exportScale,
  );
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d")!;

  // 1. Draw base captured image
  const baseImg = new Image();
  baseImg.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    baseImg.onload = resolve;
    baseImg.onerror = () => reject(new Error("Failed to load base image for export"));
    baseImg.src = imageSrc;
  });
  ctx.drawImage(baseImg, 0, 0, pxW, pxH);

  // 2. Clone SVG element & strip selection UI overlays
  if (src.svgEl) {
    const clone = src.svgEl.cloneNode(true) as SVGSVGElement;
    clone
      .querySelectorAll(EXPORT_STRIP_SELECTOR)
      .forEach((node) => node.remove());
    clone.setAttribute("width", String(pxW));
    clone.setAttribute("height", String(pxH));
    const annotatedNodes = Array.from(clone.querySelectorAll("[data-el-id]"));

    // Reproduce live-view stacking: walk elements in array order, drawing
    // each non-blur run as its own partial layer and compositing each blur
    // region at its exact position (elements before a blur stay occluded,
    // elements after it render above).
    for (const seg of segmentElementsForExport(src.getElements())) {
      if (seg.kind === "blur") {
        compositeBlurRegions(ctx, baseImg, [seg.element], canvasW, canvasH, scale);
        continue;
      }
      if (seg.kind === "text") {
        paintExportedText(ctx, seg.element, canvasW, scale);
        continue;
      }
      const visibleIds = new Set(seg.elements.map((e) => String(e.id)));
      for (const node of annotatedNodes) {
        const elId = node.getAttribute("data-el-id");
        if (elId != null && visibleIds.has(elId)) {
          (node as SVGElement).removeAttribute("style");
        } else {
          (node as SVGElement).style.display = "none";
        }
      }

      const xml = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const svgImg = new Image();
      await new Promise((resolve, reject) => {
        svgImg.onload = resolve;
        svgImg.onerror = () => reject(new Error("Failed to rasterize annotations"));
        svgImg.src = url;
      });
      ctx.drawImage(svgImg, 0, 0, pxW, pxH);
      URL.revokeObjectURL(url);
    }
  }

  // 3. Convert Canvas to PNG byte array
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to generate PNG blob");
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
