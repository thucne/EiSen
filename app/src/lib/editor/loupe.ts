import { rgbToHex } from "./elements";

export interface PixelBlock {
  data: Uint8ClampedArray; // RGBA, length = width * height * 4
  width: number;
  height: number;
}

const BLACK = "#000000";

export function buildLoupeGrid(
  imageData: PixelBlock | null,
  px: number,
  py: number,
  radius: number,
  canvasW: number,
  canvasH: number,
): string[][] {
  const sx = Math.max(0, px - radius);
  const sy = Math.max(0, py - radius);
  const ex = Math.min(canvasW, px + radius + 1);
  const ey = Math.min(canvasH, py + radius + 1);
  const sw = ex - sx;
  const sh = ey - sy;

  const grid: string[][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const row: string[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = px + dx;
      const cy = py + dy;
      if (
        !imageData ||
        sw <= 0 ||
        sh <= 0 ||
        cx < 0 ||
        cx >= canvasW ||
        cy < 0 ||
        cy >= canvasH
      ) {
        row.push(BLACK);
      } else {
        const i = ((cy - sy) * imageData.width + (cx - sx)) * 4;
        row.push(
          rgbToHex(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]),
        );
      }
    }
    grid.push(row);
  }
  return grid;
}

export interface SamplingTarget {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
}

/** Clamped source rect for the pixel readback around (px, py). sw/sh drop
 *  to ≤ 0 when the sampled block falls entirely outside the canvas. */
export function loupeSourceRect(
  px: number,
  py: number,
  radius: number,
  canvasW: number,
  canvasH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.max(0, px - radius);
  const sy = Math.max(0, py - radius);
  const sw = Math.min(canvasW, px + radius + 1) - sx;
  const sh = Math.min(canvasH, py + radius + 1) - sy;
  return { sx, sy, sw, sh };
}

/** Decodes `src` into an offscreen willReadFrequently canvas for later
 *  loupe pixel sampling. Resolves null when no DOM/image is available or
 *  the dimensions are invalid; image load errors resolve (not reject) with
 *  whatever partial target was produced. */
export async function prepareSamplingCanvas(
  src: string,
  w: number,
  h: number,
): Promise<SamplingTarget | null> {
  if (typeof document === "undefined" || !src || w <= 0 || h <= 0) return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return { canvas, ctx };
}

let samplingCache: { src: string; target: SamplingTarget } | null = null;

/** Returns a memoized sampling canvas for `src`. The first call decodes;
 *  later calls with the same source reuse the canvas. A different source
 *  invalidates the cache. `prepare` is injectable so unit tests can run
 *  without a DOM. */
export async function getSamplingCanvas(
  src: string,
  w: number,
  h: number,
  prepare: (
    src: string,
    w: number,
    h: number,
  ) => Promise<SamplingTarget | null> = prepareSamplingCanvas,
): Promise<SamplingTarget | null> {
  if (samplingCache && samplingCache.src === src) return samplingCache.target;
  const target = await prepare(src, w, h);
  samplingCache = target ? { src, target } : null;
  return target;
}

/** Test helper: drop the memoized canvas so cases can isolate cache behavior. */
export function resetSamplingCanvasCache(): void {
  samplingCache = null;
}
