import { describe, expect, it, vi } from "vitest";
import { createElement, extendElement, type Element } from "./elements";
import {
  BLUR_EXPORT_RADIUS_PX,
  BLUR_STD_DEVIATION,
  blurClipRects,
  compositeBlurRegions,
  EXPORT_STRIP_SELECTOR,
  exportPixelSize,
  MAX_EXPORT_SCALE,
  paintExportedText,
  scaleClipRect,
  segmentElementsForExport,
  wrapTextByWidth,
  type ExportSegment,
} from "./exportPipeline";

function blurElement(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): Element {
  const el = createElement("blur", p1, "#000000", 4);
  return extendElement(el, p1, p2);
}

function textElement(x: number, y: number): Element {
  return createElement("text", { x, y }, "#FFFFFF", 20);
}

function arrowElement(): Element {
  return extendElement(
    createElement("arrow", { x: 0, y: 0 }, "#FF0000", 3),
    { x: 0, y: 0 },
    { x: 50, y: 50 },
  );
}

describe("Export Pipeline Plan 019", () => {
  it("strips selection UI, base image, and live blur groups for export", () => {
    expect(EXPORT_STRIP_SELECTOR).toContain(".selection-box");
    expect(EXPORT_STRIP_SELECTOR).toContain(".handle");
    expect(EXPORT_STRIP_SELECTOR).toContain(".bg-base-image");
    expect(EXPORT_STRIP_SELECTOR).toContain(".blur-group");
    expect(EXPORT_STRIP_SELECTOR).toContain("foreignObject");
  });

  it("maps each blur element to a rounded clip rect at its bounds", () => {
    const rects = blurClipRects([blurElement({ x: 10, y: 20 }, { x: 110, y: 120 })]);
    expect(rects).toEqual([
      { x: 10, y: 20, width: 100, height: 100, rx: 4 },
    ]);
  });

  it("ignores non-blur elements when collecting clip rects", () => {
    const arrow = extendElement(
      createElement("arrow", { x: 0, y: 0 }, "#FF0000", 3),
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    );
    const rectangle = extendElement(
      createElement("rectangle", { x: 5, y: 5 }, "#00FF00", 2),
      { x: 5, y: 5 },
      { x: 25, y: 25 },
    );
    const pen = extendElement(
      createElement("pen", { x: 1, y: 1 }, "#0000FF", 2),
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    );
    const text = createElement("text", { x: 8, y: 8 }, "#FFFFFF", 20);
    const ellipse = extendElement(
      createElement("ellipse", { x: 2, y: 2 }, "#F0F000", 2),
      { x: 2, y: 2 },
      { x: 30, y: 30 },
    );
    expect(blurClipRects([arrow, rectangle, pen, text, ellipse])).toEqual([]);
  });

  it("rejects blur elements with degenerate width or height", () => {
    expect(blurClipRects([blurElement({ x: 10, y: 10 }, { x: 10, y: 50 })])).toEqual([]);
    expect(blurClipRects([blurElement({ x: 10, y: 10 }, { x: 50, y: 10 })])).toEqual([]);
    expect(blurClipRects([blurElement({ x: 10, y: 10 }, { x: 12, y: 11 })])).toHaveLength(1);
  });

  it("keeps the export blur radius calibrated to the live SVG stdDeviation", () => {
    expect(BLUR_EXPORT_RADIUS_PX).toBe(BLUR_STD_DEVIATION);
    expect(BLUR_STD_DEVIATION).toBe(8);
  });
});

describe("Export z-order segmentation (live-view occlusion parity)", () => {
  it("hides a non-blur element positioned before a blur under the blur", () => {
    const text = textElement(5, 5);
    const blur = blurElement({ x: 0, y: 0 }, { x: 50, y: 50 });
    const segments = segmentElementsForExport([text, blur]);
    expect(segments).toEqual([
      { kind: "text", element: text },
      { kind: "blur", element: blur },
    ]);
    expect(segments.map((s) => s.kind)).toEqual(["text", "blur"]);
  });

  it("renders a non-blur element positioned after a blur above it", () => {
    const blur = blurElement({ x: 0, y: 0 }, { x: 50, y: 50 });
    const arrow = arrowElement();
    expect(segmentElementsForExport([blur, arrow])).toEqual([
      { kind: "blur", element: blur },
      { kind: "run", elements: [arrow] },
    ]);
  });

  it("splits interleaved elements into alternating runs and blurs in array order", () => {
    const t1 = textElement(1, 1);
    const t2 = textElement(2, 2);
    const b1 = blurElement({ x: 0, y: 0 }, { x: 30, y: 30 });
    const t3 = textElement(3, 3);
    const t4 = textElement(4, 4);
    const b2 = blurElement({ x: 40, y: 40 }, { x: 80, y: 80 });
    expect(segmentElementsForExport([t1, t2, b1, t3, t4, b2])).toEqual([
      { kind: "text", element: t1 },
      { kind: "text", element: t2 },
      { kind: "blur", element: b1 },
      { kind: "text", element: t3 },
      { kind: "text", element: t4 },
      { kind: "blur", element: b2 },
    ]);
  });

  it("emits no empty runs around leading, trailing, or consecutive blurs", () => {
    const b1 = blurElement({ x: 0, y: 0 }, { x: 10, y: 10 });
    const b2 = blurElement({ x: 20, y: 20 }, { x: 40, y: 40 });
    const text = textElement(5, 5);
    expect(segmentElementsForExport([b1, b2, text])).toEqual([
      { kind: "blur", element: b1 },
      { kind: "blur", element: b2 },
      { kind: "text", element: text },
    ]);
    expect(segmentElementsForExport([b1])).toEqual([
      { kind: "blur", element: b1 },
    ]);
    expect(segmentElementsForExport([])).toEqual([]);
  });

  it("keeps contiguous non-blur elements together in a single run", () => {
    const text = textElement(1, 1);
    const arrow = arrowElement();
    const segments: ExportSegment[] = segmentElementsForExport([text, arrow]);
    expect(segments).toEqual([
      { kind: "text", element: text },
      { kind: "run", elements: [arrow] },
    ]);
  });

  it("splits text out of a mixed run so fillText can paint in z-order", () => {
    const arrow = arrowElement();
    const text = textElement(10, 20);
    const rect = extendElement(
      createElement("rectangle", { x: 0, y: 0 }, "#00FF00", 2),
      { x: 0, y: 0 },
      { x: 40, y: 40 },
    );
    expect(segmentElementsForExport([arrow, text, rect])).toEqual([
      { kind: "run", elements: [arrow] },
      { kind: "text", element: text },
      { kind: "run", elements: [rect] },
    ]);
  });
});

describe("wrapTextByWidth", () => {
  const measure = (s: string) => s.length * 10;

  it("keeps a short line", () => {
    expect(wrapTextByWidth("hi", 100, measure)).toEqual(["hi"]);
  });

  it("wraps on word boundaries at maxWidth", () => {
    expect(wrapTextByWidth("aa bb cc", 50, measure)).toEqual(["aa bb", "cc"]);
  });

  it("splits an overlong word", () => {
    expect(wrapTextByWidth("abcdefgh", 50, measure)).toEqual(["abcde", "fgh"]);
  });

  it("preserves explicit newlines", () => {
    expect(wrapTextByWidth("ab\ncd", 100, measure)).toEqual(["ab", "cd"]);
  });
});

describe("paintExportedText", () => {
  it("paints at (x,y) with textBaseline top", () => {
    const fillText = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText,
      measureText: (s: string) => ({ width: s.length * 10 }),
      font: "",
      fillStyle: "",
      textBaseline: "",
      textAlign: "",
    } as unknown as CanvasRenderingContext2D;
    const el = createElement("text", { x: 10, y: 20 }, "#ef4444", 18);
    if (el.kind === "text") el.text = "hi";
    paintExportedText(ctx, el, 800);
    expect(ctx.textBaseline).toBe("top");
    expect(ctx.textAlign).toBe("left");
    expect(fillText).toHaveBeenCalledWith("hi", 10, 20);
  });

  it("scales the context at exportScale 2 but still paints logical coordinates", () => {
    const fillText = vi.fn();
    const scaleFn = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: scaleFn,
      fillText,
      measureText: (s: string) => ({ width: s.length * 10 }),
      font: "",
      fillStyle: "",
      textBaseline: "",
      textAlign: "",
    } as unknown as CanvasRenderingContext2D;
    const el = createElement("text", { x: 10, y: 20 }, "#ef4444", 18);
    if (el.kind === "text") el.text = "hi";
    paintExportedText(ctx, el, 800, 2);
    expect(scaleFn).toHaveBeenCalledWith(2, 2);
    expect(fillText).toHaveBeenCalledWith("hi", 10, 20);
  });
});

describe("exportPixelSize", () => {
  it("is identity at scale 1", () => {
    expect(exportPixelSize(1280, 800, 1)).toEqual({ width: 1280, height: 800, scale: 1 });
  });

  it("doubles both axes at scale 2", () => {
    expect(exportPixelSize(1280, 800, 2)).toEqual({ width: 2560, height: 1600, scale: 2 });
  });

  it("collapses missing, non-finite, and sub-1 scales to 1", () => {
    for (const s of [undefined, null, NaN, 0, 0.5] as const) {
      expect(exportPixelSize(100, 50, s).scale).toBe(1);
      expect(exportPixelSize(100, 50, s)).toMatchObject({ width: 100, height: 50 });
    }
  });

  it("clamps above MAX_EXPORT_SCALE", () => {
    expect(exportPixelSize(10, 10, 8)).toEqual({
      width: 10 * MAX_EXPORT_SCALE,
      height: 10 * MAX_EXPORT_SCALE,
      scale: MAX_EXPORT_SCALE,
    });
  });

  it("rounds a fractional 1.5 scale", () => {
    expect(exportPixelSize(100, 50, 1.5)).toEqual({ width: 150, height: 75, scale: 1.5 });
  });

  it("never yields a 0-sized canvas from a 1×1 logical canvas", () => {
    const px = exportPixelSize(1, 1, 1);
    expect(px.width).toBeGreaterThanOrEqual(1);
    expect(px.height).toBeGreaterThanOrEqual(1);
  });
});

describe("scaleClipRect", () => {
  const r = { x: 10, y: 20, width: 30, height: 40, rx: 4 };

  it("is identity at scale 1", () => {
    expect(scaleClipRect(r, 1)).toEqual(r);
  });

  it("doubles all five fields at scale 2", () => {
    expect(scaleClipRect(r, 2)).toEqual({
      x: 20,
      y: 40,
      width: 60,
      height: 80,
      rx: 8,
    });
  });
});

describe("compositeBlurRegions", () => {
  function fakeCtx() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      filter: "",
      fillStyle: "",
    };
  }

  it("at scale 2 uses blur(16px) and doubled drawImage dimensions", () => {
    const ctx = fakeCtx();
    const el = blurElement({ x: 10, y: 20 }, { x: 110, y: 120 });
    compositeBlurRegions(
      ctx as unknown as CanvasRenderingContext2D,
      {} as CanvasImageSource,
      [el],
      200,
      100,
      2,
    );
    expect(ctx.filter).toBe("blur(16px)");
    expect(ctx.drawImage).toHaveBeenCalledWith({}, 0, 0, 400, 200);
  });

  it("at scale 1 keeps blur(8px) and original dimensions", () => {
    const ctx = fakeCtx();
    const el = blurElement({ x: 10, y: 20 }, { x: 110, y: 120 });
    compositeBlurRegions(
      ctx as unknown as CanvasRenderingContext2D,
      {} as CanvasImageSource,
      [el],
      200,
      100,
      1,
    );
    expect(ctx.filter).toBe("blur(8px)");
    expect(ctx.drawImage).toHaveBeenCalledWith({}, 0, 0, 200, 100);
  });

  it("fills the scaled rect when filter is unsupported", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    };
    const el = blurElement({ x: 10, y: 20 }, { x: 110, y: 120 });
    compositeBlurRegions(
      ctx as unknown as CanvasRenderingContext2D,
      {} as CanvasImageSource,
      [el],
      200,
      100,
      2,
    );
    expect(ctx.fillRect).toHaveBeenCalledWith(20, 40, 200, 200);
  });
});
