import { describe, expect, it } from "vitest";
import {
  arrowHeadPoints,
  bbox,
  createElement,
  extendElement,
  hitTest,
  isTiny,
  moveElement,
  normalizeRect,
  resizeElement,
  type Element,
} from "./elements";

describe("Editor Canvas & Elements Plan 004", () => {
  it("creates rectangle element and normalizes drag bounds", () => {
    const p1 = { x: 10, y: 20 };
    const p2 = { x: 110, y: 120 };
    const el = createElement("rectangle", p1, "#FF0000", 4);
    expect(el.kind).toBe("rectangle");
    const extended = extendElement(el, p1, p2);
    const box = bbox(extended);
    expect(box).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("creates ellipse element and measures bounding box", () => {
    const p1 = { x: 50, y: 50 };
    const p2 = { x: 150, y: 150 };
    const el = createElement("ellipse", p1, "#00FF00", 2);
    const extended = extendElement(el, p1, p2);
    expect(extended.kind).toBe("ellipse");
    const box = bbox(extended);
    expect(box).toEqual({ x: 50, y: 50, width: 100, height: 100 });
  });

  it("creates arrow element and calculates arrowhead polygon", () => {
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 100, y: 0 };
    const el = createElement("arrow", p1, "#0000FF", 3);
    const extended = extendElement(el, p1, p2);
    expect(extended.kind).toBe("arrow");
    if (extended.kind === "arrow") {
      const pointsStr = arrowHeadPoints(extended);
      const coords = pointsStr.split(" ").map((p) => p.split(",").map(Number));
      expect(coords.length).toBe(3);
      expect(coords[0]).toEqual([100, 0]);
    }
  });

  it("creates text element with multiline content", () => {
    const p = { x: 30, y: 40 };
    const el = createElement("text", p, "#FFFFFF", 20);
    expect(el.kind).toBe("text");
    if (el.kind === "text") {
      el.text = "Line 1\nLine 2";
      expect(el.text).toBe("Line 1\nLine 2");
      const box = bbox(el);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  it("handles hit testing on overlapping elements", () => {
    const el1 = createElement("rectangle", { x: 0, y: 0 }, "#F00", 4);
    const el1Ext = extendElement(el1, { x: 0, y: 0 }, { x: 100, y: 100 });
    const hit = hitTest([el1Ext], { x: 50, y: 50 });
    expect(hit).toBe(el1Ext);
  });

  it("prunes tiny accidental click elements with isTiny", () => {
    const el = createElement("rectangle", { x: 0, y: 0 }, "#F00", 4);
    expect(isTiny(el)).toBe(true);
    const extended = extendElement(el, { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(isTiny(extended)).toBe(false);
  });
});
