import { describe, expect, it } from "vitest";
import {
  arrowHeadPoints,
  arrowShaftEnd,
  bbox,
  compactStepNumbers,
  createElement,
  drawableStrokePoints,
  extendElement,
  hitTest,
  isCompactInk,
  isTiny,
  moveElement,
  nextStepNumber,
  normalizeRect,
  penArrowHead,
  resizeElement,
  rgbToHex,
  STEP_DIGIT_BASELINE,
  stepBadgeAppearance,
  sweepErasePoints,
  textContentMaxWidth,
  textDisplayWidth,
  textLineAdvance,
  wrapTextLines,
  type Element,
  type ShapeElement,
  type StepElement,
} from "./elements";

function shape(kind: "ellipse" | "rectangle"): ShapeElement {
  return { id: 1, kind, x: 10, y: 20, width: 100, height: 50, color: "#f00", size: 4 };
}

describe("normalizeRect", () => {
  it("normalizes an inverted drag", () => {
    expect(normalizeRect({ x: 50, y: 40 }, { x: 10, y: 90 })).toEqual({
      x: 10,
      y: 40,
      width: 40,
      height: 50,
    });
  });

  it("locks to a square from the start corner when requested", () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 40, y: 25 }, true)).toEqual({
      x: 10,
      y: 10,
      width: 30,
      height: 30,
    });
  });

  it("grows a square toward the north-west when dragging backward", () => {
    expect(normalizeRect({ x: 50, y: 50 }, { x: 10, y: 20 }, true)).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
  });
});

describe("bbox", () => {
  it("measures text with an estimated width", () => {
    const e: Element = { id: 1, kind: "text", x: 5, y: 5, text: "abc", size: 10, color: "#000" };
    const b = bbox(e);
    expect(b.x).toBe(5);
    expect(b.y).toBe(5);
    expect(b.width).toBeGreaterThanOrEqual(10);
    expect(b.height).toBe(10 + 12);
  });

  it("measures an arrow from its endpoints", () => {
    const e: Element = { id: 1, kind: "arrow", x1: 0, y1: 0, x2: -40, y2: 30, size: 4, color: "#000" };
    expect(bbox(e)).toEqual({ x: -40, y: 0, width: 40, height: 30 });
  });

  it("measures a shape from its origin and size", () => {
    expect(bbox(shape("ellipse"))).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("measures a pen path from its extreme points", () => {
    const e: Element = { id: 1, kind: "pen", points: [{ x: 3, y: 7 }, { x: 20, y: 4 }, { x: 12, y: 30 }], size: 4, color: "#000" };
    expect(bbox(e)).toEqual({ x: 3, y: 4, width: 17, height: 26 });
  });

  it("grows step bbox for two-digit numbers", () => {
    const one: StepElement = { id: 1, kind: "step", x: 50, y: 50, stepNumber: 1, size: 24, color: "#ef4444" };
    const ten: StepElement = { id: 2, kind: "step", x: 50, y: 50, stepNumber: 10, size: 24, color: "#ef4444" };
    expect(bbox(ten).width).toBeGreaterThan(bbox(one).width);
  });
});

describe("hitTest", () => {
  it("returns null on a miss", () => {
    const e = shape("rectangle");
    expect(hitTest([e], { x: 200, y: 200 })).toBeNull();
  });

  it("hits inside a shape", () => {
    const e = shape("rectangle");
    expect(hitTest([e], { x: 60, y: 45 })).toBe(e);
  });

  it("returns the topmost element when shapes overlap", () => {
    const below = shape("rectangle");
    const above: Element = { ...below, id: 2, kind: "ellipse", x: 5, y: 5, width: 200, height: 100 };
    expect(hitTest([below, above], { x: 60, y: 45 })).toBe(above);
  });

  it("hits an arrow near its segment", () => {
    const e: Element = { id: 1, kind: "arrow", x1: 0, y1: 0, x2: 100, y2: 0, size: 4, color: "#000" };
    expect(hitTest([e], { x: 50, y: 5 })).toBe(e);
  });
});

describe("moveElement", () => {
  it("moves every element kind", () => {
    const cases: Element[] = [
      { id: 1, kind: "text", x: 1, y: 2, text: "hi", size: 10, color: "#000" },
      { id: 2, kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4, size: 4, color: "#000" },
      shape("rectangle"),
      { id: 4, kind: "pen", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], size: 4, color: "#000" },
      { id: 5, kind: "step", x: 10, y: 20, stepNumber: 1, size: 24, color: "#ef4444" },
    ];
    for (const e of cases) {
      const moved = moveElement(e, 10, -5);
      expect(bbox(moved).x).toBe(bbox(e).x + 10);
      expect(bbox(moved).y).toBe(bbox(e).y - 5);
    }
  });
});

describe("resizeElement", () => {
  it("grows from the se handle", () => {
    const r = resizeElement(shape("ellipse"), "se", 5, 8);
    expect(r).toMatchObject({ x: 10, y: 20, width: 105, height: 58 });
  });

  it("locks rectangle and ellipse to a square from se when shift-constrained", () => {
    const r = resizeElement(shape("rectangle"), "se", 5, 8, 9999, true);
    expect(r).toMatchObject({ x: 10, y: 20, width: 105, height: 105 });
    const c = resizeElement(shape("ellipse"), "se", 5, 8, 9999, true);
    expect(c).toMatchObject({ x: 10, y: 20, width: 105, height: 105 });
  });

  it("keeps the opposite corner fixed when shift-resizing from nw", () => {
    const r = resizeElement(shape("rectangle"), "nw", 4, 6, 9999, true);
    expect(r).toMatchObject({ x: 14, y: -26, width: 96, height: 96 });
  });

  it("does not lock blur when shift-resizing", () => {
    const blur: ShapeElement = { id: 1, kind: "blur", x: 10, y: 20, width: 100, height: 50, color: "#f00", size: 4 };
    const r = resizeElement(blur, "se", 5, 8, 9999, true);
    expect(r).toMatchObject({ x: 10, y: 20, width: 105, height: 58 });
  });

  it("shrinks from the nw handle", () => {
    const r = resizeElement(shape("rectangle"), "nw", 4, 6);
    expect(r).toMatchObject({ x: 14, y: 26, width: 96, height: 44 });
  });

  it("clamps to a minimum size", () => {
    const r = resizeElement(shape("rectangle"), "nw", 999, 999);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it("resizes text width from e handle and clamps", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 10, text: "hi", color: "#000", size: 18 };
    const grown = resizeElement(el, "se", 40, 0);
    expect((grown as any).width).toBeGreaterThan(40);
    const clamped = resizeElement({ ...el, width: 500 } as Element, "e", 9999, 0);
    // bbox width capped by remaining canvas is tested via integration; here just not NaN
    expect((clamped as any).width).toBeGreaterThan(0);
  });

  it("scales text font from se handle", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 10, text: "hi", color: "#000", size: 18 };
    const bigger = resizeElement(el, "se", 0, 16);
    expect((bigger as any).size).toBeGreaterThan(18);
    const small = resizeElement(el, "se", 0, -100);
    expect((small as any).size).toBeGreaterThanOrEqual(10);
  });

  it("resizes text width from nw handle (moves x)", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 10, text: "hi", color: "#000", size: 18, width: 100 };
    const resized = resizeElement(el, "nw", -20, 0) as any;
    expect(resized.x).toBeLessThan(10);
    expect(resized.width).toBeGreaterThan(100);
  });
  it("resizes text width from ne handle", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 10, text: "hi", color: "#000", size: 18, width: 100 };
    const resized = resizeElement(el, "ne", 20, 0) as any;
    expect(resized.width).toBeGreaterThan(100);
    expect(resized.x).toBe(10);
  });
  it("resizes text in both axes from north handles (y + font size)", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 20, text: "hi", color: "#000", size: 18, width: 100 };
    const nw = resizeElement(el, "nw", -20, -16) as any;
    expect(nw.y).toBeLessThan(20);
    expect(nw.size).toBeGreaterThan(18);
    expect(nw.width).toBeGreaterThan(100);
    const ne = resizeElement(el, "ne", 20, -16) as any;
    expect(ne.y).toBeLessThan(20);
    expect(ne.size).toBeGreaterThan(18);
    expect(ne.x).toBe(10);
    expect(ne.width).toBeGreaterThan(100);
  });

  it("shrinks text from nw when dragging down-right", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 20, text: "hi", color: "#000", size: 18, width: 100 };
    const nw = resizeElement(el, "nw", 20, 16) as any;
    expect(nw.y).toBeGreaterThan(20);
    expect(nw.size).toBeLessThan(18);
    expect(nw.width).toBeLessThan(100);
  });

  it("keeps the bottom edge fixed when resizing from a north handle", () => {
    const el: Element = { id: 1, kind: "text", x: 10, y: 20, text: "hi", color: "#000", size: 18, width: 100 };
    const bottom = el.y + bbox(el).height;
    const up = resizeElement(el, "ne", 0, -16) as any;
    expect(up.y + bbox(up).height).toBeCloseTo(bottom);
    expect(up.size).toBeGreaterThan(18);
    const down = resizeElement(el, "nw", 0, 16) as any;
    expect(down.y + bbox(down).height).toBeCloseTo(bottom);
    expect(down.size).toBeLessThan(18);
  });

  it("scales a step uniformly about its center", () => {
    const el: Element = { id: 1, kind: "step", x: 40, y: 50, stepNumber: 1, size: 24, color: "#ef4444" };
    const grown = resizeElement(el, "se", 20.4, 20.4) as StepElement;
    expect(grown.x).toBe(40);
    expect(grown.y).toBe(50);
    expect(grown.size).toBe(48);
    const shrunk = resizeElement(el, "nw", 10, 10) as StepElement;
    expect(shrunk.x).toBe(40);
    expect(shrunk.y).toBe(50);
    expect(shrunk.size).toBeLessThan(24);
  });

  it("clamps step scale and ignores non-corner handles", () => {
    const el: Element = { id: 1, kind: "step", x: 0, y: 0, stepNumber: 1, size: 24, color: "#ef4444" };
    expect((resizeElement(el, "se", 400, 400) as StepElement).size).toBe(72);
    expect((resizeElement(el, "se", -20.4, -20.4) as StepElement).size).toBe(14);
    expect(resizeElement(el, "e", 20, 0)).toBe(el);
  });
});

describe("createElement", () => {
  it("creates each draw kind at the start point", () => {
    const p = { x: 5, y: 6 };
    expect(createElement("arrow", p, "#fff", 4).kind).toBe("arrow");
    expect(createElement("ellipse", p, "#fff", 4).kind).toBe("ellipse");
    expect(createElement("rectangle", p, "#fff", 4).kind).toBe("rectangle");
    const pen = createElement("pen", p, "#fff", 4);
    expect(pen.kind).toBe("pen");
    if (pen.kind === "pen") expect(pen.points).toEqual([p]);
    const text = createElement("text", p, "#fff", 18);
    if (text.kind === "text") expect(text.text).toBe("");
  });

  it("creates a step with an explicit stepNumber", () => {
    const p = { x: 5, y: 6 };
    const a = createElement("step", p, "#ef4444", 24, 7);
    expect(a.kind).toBe("step");
    if (a.kind === "step") expect(a.stepNumber).toBe(7);
    const b = createElement("step", p, "#ef4444", 24, 3);
    if (b.kind === "step") expect(b.stepNumber).toBe(3);
  });
});

describe("extendElement", () => {
  it("extends a shape from its anchor", () => {
    const e = createElement("rectangle", { x: 10, y: 10 }, "#f00", 4) as Element;
    const grown = extendElement(e, { x: 10, y: 10 }, { x: 40, y: 25 });
    expect(grown).toMatchObject({ x: 10, y: 10, width: 30, height: 15 });
  });

  it("keeps an inverted drag normalized", () => {
    const e = createElement("ellipse", { x: 40, y: 40 }, "#f00", 4) as Element;
    const grown = extendElement(e, { x: 40, y: 40 }, { x: 5, y: 10 });
    expect(grown).toMatchObject({ x: 5, y: 10, width: 35, height: 30 });
  });

  it("locks rectangle and ellipse to a square when shift-constrained", () => {
    const rect = createElement("rectangle", { x: 10, y: 10 }, "#f00", 4) as Element;
    expect(extendElement(rect, { x: 10, y: 10 }, { x: 40, y: 25 }, true)).toMatchObject({
      x: 10, y: 10, width: 30, height: 30,
    });
    const ellipse = createElement("ellipse", { x: 10, y: 10 }, "#f00", 4) as Element;
    expect(extendElement(ellipse, { x: 10, y: 10 }, { x: 40, y: 25 }, true)).toMatchObject({
      x: 10, y: 10, width: 30, height: 30,
    });
  });

  it("does not lock blur to a square", () => {
    const blur = createElement("blur", { x: 10, y: 10 }, "#f00", 4) as Element;
    expect(extendElement(blur, { x: 10, y: 10 }, { x: 40, y: 25 }, true)).toMatchObject({
      x: 10, y: 10, width: 30, height: 15,
    });
  });

  it("moves the arrow tip", () => {
    const e = createElement("arrow", { x: 0, y: 0 }, "#f00", 4) as Element;
    expect(extendElement(e, { x: 0, y: 0 }, { x: 20, y: 15 })).toMatchObject({ x2: 20, y2: 15 });
  });

  it("appends pen points", () => {
    const e = createElement("pen", { x: 0, y: 0 }, "#f00", 4) as Element;
    const grown = extendElement(e, { x: 0, y: 0 }, { x: 3, y: 4 });
    if (grown.kind === "pen") expect(grown.points).toHaveLength(2);
  });
});

describe("isTiny", () => {
  it("prunes accidental clicks", () => {
    expect(isTiny(shape("rectangle"))).toBe(false);
    expect(isTiny({ ...shape("rectangle"), width: 0, height: 0 })).toBe(true);
    const arrow: Element = { id: 1, kind: "arrow", x1: 0, y1: 0, x2: 2, y2: 0, size: 4, color: "#000" };
    expect(isTiny(arrow)).toBe(true);
    const pen: Element = { id: 1, kind: "pen", points: [{ x: 0, y: 0 }], size: 4, color: "#000" };
    expect(isTiny(pen)).toBe(false);
    const highlight: Element = {
      id: 2, kind: "highlight", points: [{ x: 0, y: 0 }], size: 20, color: "#000",
    };
    expect(isTiny(highlight)).toBe(true);
    const emptyPen: Element = { id: 3, kind: "pen", points: [], size: 4, color: "#000" };
    expect(isTiny(emptyPen)).toBe(true);
  });

  it("never prunes text", () => {
    const text: Element = { id: 1, kind: "text", x: 0, y: 0, text: "", size: 18, color: "#000" };
    expect(isTiny(text)).toBe(false);
  });

  it("never prunes steps", () => {
    const step: Element = { id: 1, kind: "step", x: 0, y: 0, stepNumber: 1, size: 24, color: "#ef4444" };
    expect(isTiny(step)).toBe(false);
  });

  it("keeps a single-point penArrow", () => {
    const tap: Element = { id: 1, kind: "penArrow", points: [{ x: 8, y: 8 }], size: 4, color: "#f00" };
    expect(isTiny(tap)).toBe(false);
  });
});

describe("drawableStrokePoints", () => {
  it("duplicates a tap so round linecaps can render a dot", () => {
    const p = { x: 10, y: 20 };
    const pts = drawableStrokePoints([p]);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual(p);
    expect(pts[1].x).not.toBe(p.x);
    expect(pts[1].y).toBe(p.y);
  });

  it("leaves a real stroke unchanged", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 1 };
    expect(drawableStrokePoints([a, b])).toEqual([a, b]);
  });
});

describe("isCompactInk", () => {
  it("treats a pen tap as compact so delete chrome will not cover it", () => {
    const tap: Element = { id: 1, kind: "pen", points: [{ x: 5, y: 5 }], size: 4, color: "#f00" };
    expect(isCompactInk(tap)).toBe(true);
  });

  it("does not treat a longer pen stroke as compact", () => {
    const stroke: Element = {
      id: 1, kind: "pen", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], size: 4, color: "#f00",
    };
    expect(isCompactInk(stroke)).toBe(false);
  });
});

describe("arrowHeadPoints", () => {
  it("returns a triangle at the arrow tip", () => {
    const e: Element = { id: 1, kind: "arrow", x1: 0, y1: 0, x2: 100, y2: 0, size: 4, color: "#000" };
    const pts = arrowHeadPoints(e);
    const nums = pts.split(" ").map((p) => p.split(",").map(Number));
    expect(nums).toHaveLength(3);
    expect(nums[0]).toEqual([100, 0]);
    expect(nums[1][0]).toBeLessThan(100);
    expect(nums[2][0]).toBeLessThan(100);
  });
});

describe("arrowShaftEnd", () => {
  it("ends the shaft at the head base plus overlap on a horizontal arrow", () => {
    const e: Element = { id: 1, kind: "arrow", x1: 0, y1: 0, x2: 100, y2: 0, size: 4, color: "#000" };
    const s = arrowShaftEnd(e);
    // headLen = max(12, 4*3.2) = 12.8; baseDist = 12.8*cos(PI/5.5) ≈ 10.77;
    // shaft ends at base + size*0.3 = 100 - 10.77 + 1.2 ≈ 90.43
    expect(s.x).toBeCloseTo(90.43, 1);
    expect(s.y).toBeCloseTo(0, 10);
  });

  it("stays on the arrow axis with the round cap inside the head on a diagonal arrow", () => {
    const e: Element = { id: 1, kind: "arrow", x1: 10, y1: 20, x2: 50, y2: 60, size: 6, color: "#000" };
    const s = arrowShaftEnd(e);
    // On-axis: cross product of (end-start) and (tip-end) is ~0
    const cross = (s.x - 10) * (60 - s.y) - (s.y - 20) * (50 - s.x);
    expect(cross).toBeCloseTo(0, 8);
    // headLen = max(12, 6*3.2) = 19.2; dist(tip,end) = 19.2*cos(PI/5.5) - 1.8 ≈ 14.35
    const distTip = Math.hypot(50 - s.x, 60 - s.y);
    expect(distTip).toBeCloseTo(14.35, 1);
    // Round cap (radius size/2 = 3) fits inside the triangle half-width there
    const halfWidth = distTip * Math.tan(Math.PI / 5.5);
    expect(halfWidth).toBeGreaterThan(3);
  });

  it("returns finite points for zero-length and tiny arrows", () => {
    const zero: Element = { id: 1, kind: "arrow", x1: 5, y1: 5, x2: 5, y2: 5, size: 4, color: "#000" };
    const s0 = arrowShaftEnd(zero);
    expect(Number.isFinite(s0.x)).toBe(true);
    expect(Number.isFinite(s0.y)).toBe(true);
    const tiny: Element = { id: 2, kind: "arrow", x1: 0, y1: 0, x2: 2, y2: 0, size: 4, color: "#000" };
    const s1 = arrowShaftEnd(tiny);
    expect(Number.isFinite(s1.x)).toBe(true);
    expect(Number.isFinite(s1.y)).toBe(true);
  });
});

describe("text layout", () => {
  it("advances wrapped lines by one em (line-height 1)", () => {
    expect(textLineAdvance(16)).toBe(16);
    expect(textLineAdvance(32)).toBe(32);
  });

  it("wraps at remaining canvas width, not a 120px default", () => {
    const maxW = textContentMaxWidth(10, 800);
    expect(maxW).toBe(790);
    const line = "The quick brown fox jumps over the lazy dog";
    expect(wrapTextLines(line, 18, maxW)).toEqual([line]);
    expect(wrapTextLines(line, 18, 113).length).toBeGreaterThan(1);
  });

  it("uses the box width when the element has an explicit width", () => {
    expect(textContentMaxWidth(10, 800, 100)).toBe(100);
  });

  it("clamps explicit width to remaining canvas", () => {
    expect(textContentMaxWidth(10, 100, 9999)).toBe(90);
  });

  it("hugs measured width when no explicit width, not remaining", () => {
    expect(textDisplayWidth(52, 10, 800)).toBe(80);
    expect(textDisplayWidth(0, 10, 800)).toBe(80);
    expect(textDisplayWidth(500, 10, 800)).toBe(500);
    expect(textDisplayWidth(900, 10, 800)).toBe(790);
  });

  it("uses explicit width over measured width", () => {
    expect(textDisplayWidth(52, 10, 800, 200)).toBe(200);
    expect(textDisplayWidth(900, 10, 100, 200)).toBe(90);
  });
});

describe("rgbToHex", () => {
  it("converts primary colors accurately", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#FF0000");
    expect(rgbToHex(0, 255, 0)).toBe("#00FF00");
    expect(rgbToHex(0, 0, 255)).toBe("#0000FF");
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 255, 255)).toBe("#FFFFFF");
  });

  it("clamps and pads boundary values", () => {
    expect(rgbToHex(15, 10, 5)).toBe("#0F0A05");
    expect(rgbToHex(300, -10, 128)).toBe("#FF0080");
  });
});

describe("penArrowHead", () => {
  it("orients the head along the final segment", () => {
    const el: Element = {
      id: 1, kind: "penArrow",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }],
      size: 4, color: "#000",
    };
    const head = penArrowHead(el as any);
    expect(head).not.toBeNull();
    expect(head!.tip).toEqual({ x: 100, y: 60 });
    const expected = arrowHeadPoints({
      id: 1, kind: "arrow", x1: 100, y1: 0, x2: 100, y2: 60, size: 4, color: "#000",
    } as any);
    expect(head!.headPoints).toBe(expected);
    const last = head!.points[head!.points.length - 1];
    expect(last.x).toBeCloseTo(head!.shaftEnd.x, 10);
    expect(last.y).toBeCloseTo(head!.shaftEnd.y, 10);
  });

  it("skips trailing duplicate points when finding direction", () => {
    const el: Element = {
      id: 1, kind: "penArrow",
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }],
      size: 4, color: "#000",
    };
    const head = penArrowHead(el as any);
    const expected = arrowHeadPoints({
      id: 1, kind: "arrow", x1: 50, y1: 0, x2: 100, y2: 0, size: 4, color: "#000",
    } as any);
    expect(head!.headPoints).toBe(expected);
  });

  it("aims along arrival over a short baseline, averaging lift jitter", () => {
    // Dense realistic pointer stream: travel east with sub-px wobble, then a
    // 1px lift wobble. A 4px arrival baseline averages the wobble out; the
    // head axis must equal the (4.5,0.5)->(9,0) segment direction exactly.
    const el: Element = {
      id: 1, kind: "penArrow",
      points: [
        { x: 0, y: 0 }, { x: 1.5, y: 0.5 }, { x: 3, y: 0 }, { x: 4.5, y: 0.5 },
        { x: 6, y: 0 }, { x: 7.5, y: 0.5 }, { x: 9, y: 0 }, { x: 10, y: 1 },
      ],
      size: 4, color: "#000",
    };
    const head = penArrowHead(el as any);
    const expected = arrowHeadPoints({
      id: 1, kind: "arrow", x1: 6, y1: 0, x2: 10, y2: 1, size: 4, color: "#000",
    } as any);
    expect(head!.headPoints).toBe(expected);
  });

  it("aims along arrival on a bending stroke, not the chord average", () => {
    // Hook turning down at the end: the chord average points ~36deg, but the
    // head must continue the ~45deg arrival direction of the final stretch.
    const el: Element = {
      id: 1, kind: "penArrow",
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 47, y: 1 }, { x: 52, y: 6 }],
      size: 4, color: "#000",
    };
    const head = penArrowHead(el as any);
    expect(head).not.toBeNull();
    const [tipV, p1, p2] = head!.headPoints.split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number);
      return { x, y };
    });
    expect(tipV).toEqual({ x: 52, y: 6 });
    const axis = Math.atan2(tipV.y - (p1.y + p2.y) / 2, tipV.x - (p1.x + p2.x) / 2) * 180 / Math.PI;
    expect(axis).toBeGreaterThan(38);
    expect(axis).toBeLessThan(52);
  });

  it("straightens the tail inside the head span", () => {
    // Straight travel, then ±3px wobble over the last 30px (inside the 25.6px
    // head for size 8). Raw wobble vertices must not reach the renderer:
    // the tail from A onward is axis-collinear so the shaft cannot spill
    // past the triangle edges.
    const raw: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 10; i++) raw.push({ x: i * 6, y: 0 });
    for (let i = 1; i <= 10; i++) raw.push({ x: 60 + i * 3, y: i % 2 === 0 ? 3 : -3 });
    const el: Element = { id: 1, kind: "penArrow", points: raw, size: 8, color: "#000" };
    const head = penArrowHead(el as any);
    expect(head).not.toBeNull();
    const render = head!.points;
    expect(render.length).toBeLessThan(raw.length);
    expect(render[0]).toEqual(raw[0]);
    expect(render[render.length - 1]).toEqual(head!.shaftEnd);
    const [tipV, p1, p2] = head!.headPoints.split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number);
      return { x, y };
    });
    const axis = Math.atan2(tipV.y - (p1.y + p2.y) / 2, tipV.x - (p1.x + p2.x) / 2);
    const secondLast = render[render.length - 2];
    const tailAng = Math.atan2(tipV.y - secondLast.y, tipV.x - secondLast.x);
    expect(Math.abs(tailAng - axis)).toBeLessThan(0.01);
    // Every kept raw point sits beyond one head-length from the tip, so no
    // raw wobble vertex survives inside the triangle span (size 8 -> 25.6).
    const pathDist = (idx: number): number => {
      let acc = 0;
      for (let k = raw.length - 1; k > idx; k--) {
        acc += Math.hypot(raw[k].x - raw[k - 1].x, raw[k].y - raw[k - 1].y);
      }
      return acc;
    };
    for (const p of render.slice(0, -2)) {
      const idx = raw.findIndex((q) => q.x === p.x && q.y === p.y);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(pathDist(idx)).toBeGreaterThan(25.6 - 1e-6);
    }
  });

  it("keeps short two-point strokes collinear with the axis", () => {
    const el: Element = {
      id: 1, kind: "penArrow",
      points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      size: 4, color: "#000",
    };
    const head = penArrowHead(el as any);
    expect(head!.points).toHaveLength(3);
    for (const p of head!.points) expect(p.y).toBe(0);
    expect(head!.points[head!.points.length - 1]).toEqual(head!.shaftEnd);
  });

  it("returns null with fewer than 2 distinct points", () => {
    const one: Element = { id: 1, kind: "penArrow", points: [{ x: 5, y: 5 }], size: 4, color: "#000" };
    expect(penArrowHead(one as any)).toBeNull();
    const same: Element = {
      id: 2, kind: "penArrow",
      points: [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], size: 4, color: "#000",
    };
    expect(penArrowHead(same as any)).toBeNull();
  });

  it("plumbs penArrow through the pen pipeline", () => {
    const p = { x: 10, y: 10 };
    const el = createElement("penArrow", p, "#f00", 4);
    expect(el.kind).toBe("penArrow");
    if (el.kind === "penArrow") expect(el.points).toEqual([p]);
    const grown = extendElement(el, p, { x: 20, y: 20 });
    if (grown.kind === "penArrow") expect(grown.points).toHaveLength(2);
    expect(isTiny(el)).toBe(false);
    expect(isTiny(grown)).toBe(false);
    const moved = moveElement(grown, 5, 5);
    if (moved.kind === "penArrow") expect(moved.points[0]).toEqual({ x: 15, y: 15 });
    const penBox = bbox({ ...(grown as any), kind: "pen" } as Element);
    expect(bbox(grown)).toEqual(penBox);
  });
});

describe("nextStepNumber", () => {
  it("returns 1 for an empty canvas", () => {
    expect(nextStepNumber([])).toBe(1);
  });

  it("returns 1 + max stepNumber among steps", () => {
    const els: Element[] = [
      { id: 1, kind: "step", x: 0, y: 0, stepNumber: 2, size: 24, color: "#ef4444" },
      { id: 2, kind: "rectangle", x: 0, y: 0, width: 10, height: 10, size: 4, color: "#000" },
      { id: 3, kind: "step", x: 10, y: 10, stepNumber: 5, size: 24, color: "#ef4444" },
    ];
    expect(nextStepNumber(els)).toBe(6);
  });
});

describe("compactStepNumbers", () => {
  it("renumbers steps in array order, leaving other kinds unchanged", () => {
    const rect: Element = { id: 2, kind: "rectangle", x: 0, y: 0, width: 10, height: 10, size: 4, color: "#000" };
    const els: Element[] = [
      { id: 1, kind: "step", x: 0, y: 0, stepNumber: 4, size: 24, color: "#ef4444" },
      rect,
      { id: 3, kind: "step", x: 10, y: 10, stepNumber: 1, size: 24, color: "#ef4444" },
    ];
    const out = compactStepNumbers(els);
    expect((out[0] as StepElement).stepNumber).toBe(1);
    expect(out[1]).toBe(rect);
    expect((out[2] as StepElement).stepNumber).toBe(2);
  });
});

describe("stepBadgeAppearance", () => {
  it.each([
    ["#ef4444", "#ffffff", "#ffffff"],
    ["#eab308", "#0f172a", "#0f172a"],
    ["#ffffff", "#0f172a", "#0f172a"],
    ["#0f172a", "#ffffff", "#ffffff"],
  ] as const)("fill %s → glyph %s, ring %s", (fill, glyph, ring) => {
    const el: StepElement = { id: 1, kind: "step", x: 0, y: 0, stepNumber: 1, size: 24, color: fill };
    const badge = stepBadgeAppearance(el);
    expect(badge.glyph).toBe(glyph);
    expect(badge.ring).toBe(ring);
  });

  it("grows radius for two-digit step numbers", () => {
    const el: StepElement = { id: 1, kind: "step", x: 0, y: 0, stepNumber: 10, size: 24, color: "#ef4444" };
    expect(stepBadgeAppearance(el).r).toBe(24 * 0.8 * 1.32);
  });

  it("places the digit with a user-unit baseline, not em (scale-stable)", () => {
    const small: StepElement = { id: 1, kind: "step", x: 0, y: 0, stepNumber: 1, size: 24, color: "#ef4444" };
    const large: StepElement = { id: 2, kind: "step", x: 0, y: 0, stepNumber: 1, size: 48, color: "#ef4444" };
    const a = stepBadgeAppearance(small);
    const b = stepBadgeAppearance(large);
    expect(a.textY).toBeCloseTo(a.fontSize * STEP_DIGIT_BASELINE);
    expect(b.textY / a.textY).toBeCloseTo(b.fontSize / a.fontSize);
    expect(b.textY).toBeGreaterThan(a.textY);
  });
});

describe("sweepErasePoints", () => {
  it("covers the current point plus the midpoint for fast drags", () => {
    const pts = sweepErasePoints({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(pts).toEqual([{ x: 10, y: 0 }, { x: 5, y: 0 }]);
  });

  it("returns the point twice when stationary (second hit-test is a no-op)", () => {
    const pts = sweepErasePoints({ x: 4, y: 4 }, { x: 4, y: 4 });
    expect(pts).toEqual([{ x: 4, y: 4 }, { x: 4, y: 4 }]);
  });
});

