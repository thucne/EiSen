import { describe, expect, it } from "vitest";
import {
  computeToolbarPosition,
  oppositeCorner,
  selectionRect,
  shiftRect,
  type Point,
  type Rect,
  type Viewport,
} from "./geometry";

describe("Overlay Selection Geometry (selectionRect)", () => {
  it("computes rectangle when dragging from top-left to bottom-right", () => {
    const p1: Point = { x: 100, y: 150 };
    const p2: Point = { x: 300, y: 400 };
    const rect = selectionRect(p1, p2, false);

    expect(rect).toEqual({
      left: 100,
      top: 150,
      width: 200,
      height: 250,
    });
  });

  it("computes rectangle when dragging in reverse (bottom-right to top-left)", () => {
    const p1: Point = { x: 400, y: 500 };
    const p2: Point = { x: 150, y: 200 };
    const rect = selectionRect(p1, p2, false);

    expect(rect).toEqual({
      left: 150,
      top: 200,
      width: 250,
      height: 300,
    });
  });

  it("locks to 1:1 aspect ratio when square is true (wider width dominates)", () => {
    const p1: Point = { x: 100, y: 100 };
    const p2: Point = { x: 400, y: 200 }; // dx = 300, dy = 100
    const rect = selectionRect(p1, p2, true);

    expect(rect).toEqual({
      left: 100,
      top: 100,
      width: 300,
      height: 300,
    });
  });

  it("locks to 1:1 aspect ratio when square is true with negative coordinates", () => {
    const p1: Point = { x: 500, y: 500 };
    const p2: Point = { x: 300, y: 450 }; // dx = 200, dy = 50 -> side = 200
    const rect = selectionRect(p1, p2, true);

    expect(rect).toEqual({
      left: 300,
      top: 300,
      width: 200,
      height: 200,
    });
  });
});

describe("Responsive Toolbar Positioning (computeToolbarPosition)", () => {
  const viewport: Viewport = { width: 1920, height: 1080 };
  const toolbarWidth = 320;
  const toolbarHeight = 40;
  const gap = 16;

  it("places toolbar below selection when there is sufficient viewport space", () => {
    const rect: Rect = { left: 400, top: 200, width: 600, height: 400 };
    const pos = computeToolbarPosition(rect, viewport, toolbarWidth, toolbarHeight, gap);

    expect(pos.inside).toBe(false);
    expect(pos.y).toBe(rect.top + rect.height + gap); // 200 + 400 + 16 = 616
    expect(pos.x).toBe(rect.left + rect.width - (toolbarWidth + gap) + gap); // 400 + 600 - 336 + 16 = 680
  });

  it("flips toolbar above selection when colliding with the bottom viewport edge", () => {
    const rect: Rect = { left: 400, top: 700, width: 600, height: 350 };
    // belowY = 700 + 350 + 16 = 1066. With toolbarHeight (40) + gap (16) = 1122 > 1080 -> flips above
    const pos = computeToolbarPosition(rect, viewport, toolbarWidth, toolbarHeight, gap);

    expect(pos.inside).toBe(false);
    expect(pos.y).toBe(rect.top - toolbarHeight - gap); // 700 - 40 - 16 = 644
  });

  it("renders inside selection when both top and bottom edges lack space", () => {
    // Fullscreen-like selection
    const rect: Rect = { left: 0, top: 10, width: 1920, height: 1060 };
    const pos = computeToolbarPosition(rect, viewport, toolbarWidth, toolbarHeight, gap);

    expect(pos.inside).toBe(true);
    expect(pos.y).toBeLessThanOrEqual(viewport.height - toolbarHeight - gap);
    expect(pos.x).toBeLessThanOrEqual(viewport.width - (toolbarWidth + gap));
  });

  it("clamps toolbar X coordinate within horizontal viewport boundaries", () => {
    const rect: Rect = { left: 1800, top: 200, width: 200, height: 200 };
    const pos = computeToolbarPosition(rect, viewport, toolbarWidth, toolbarHeight, gap);

    // Toolbar must not overflow 1920 viewport width
    const tw = toolbarWidth + gap;
    expect(pos.x).toBeLessThanOrEqual(viewport.width - tw);
    expect(pos.x).toBeGreaterThanOrEqual(gap);
  });
});

describe("Selection Pan / Shift (shiftRect)", () => {
  const viewport: Viewport = { width: 1920, height: 1080 };

  it("shifts rectangle by delta x and delta y without changing size", () => {
    const rect: Rect = { left: 100, top: 100, width: 200, height: 150 };
    const shifted = shiftRect(rect, 50, -30);

    expect(shifted).toEqual({
      left: 150,
      top: 70,
      width: 200,
      height: 150,
    });
  });

  it("clamps shifted rectangle within viewport boundaries", () => {
    const rect: Rect = { left: 100, top: 100, width: 200, height: 150 };
    const shifted = shiftRect(rect, -200, 1000, viewport);

    expect(shifted.left).toBe(0);
    expect(shifted.top).toBe(1080 - 150); // 930
    expect(shifted.width).toBe(200);
    expect(shifted.height).toBe(150);
  });
});

describe("oppositeCorner", () => {
  const rect: Rect = { left: 10, top: 20, width: 100, height: 50 };

  it("returns the diagonally opposite corner for each handle", () => {
    expect(oppositeCorner(rect, "nw")).toEqual({ x: 110, y: 70 });
    expect(oppositeCorner(rect, "ne")).toEqual({ x: 10, y: 70 });
    expect(oppositeCorner(rect, "sw")).toEqual({ x: 110, y: 20 });
    expect(oppositeCorner(rect, "se")).toEqual({ x: 10, y: 20 });
  });
});
