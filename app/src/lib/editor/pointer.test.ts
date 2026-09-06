import { describe, expect, it } from "vitest";
import {
  DELETE_BUTTON_SIZE,
  deleteButtonPosition,
  cornerHandles,
  handleAt,
  shouldBeginResize,
  sizeControlVisible,
  stampHitIntent,
  textBodyIntent,
  textDragArmed,
} from "./pointer";

describe("shouldBeginResize", () => {
  it("resizes a selected text marker from a corner while the text tool is active", () => {
    expect(
      shouldBeginResize({
        handle: "se",
        tool: "text",
        targetKind: "text",
      }),
    ).toBe(true);
  });

  it("resizes while any drawing tool is active, not only select", () => {
    expect(
      shouldBeginResize({
        handle: "nw",
        tool: "arrow",
        targetKind: "rectangle",
      }),
    ).toBe(true);
  });

  it("does not steal eraser or eyedropper gestures", () => {
    expect(
      shouldBeginResize({
        handle: "se",
        tool: "eraser",
        targetKind: "text",
      }),
    ).toBe(false);
    expect(
      shouldBeginResize({
        handle: "se",
        tool: "eyedropper",
        targetKind: "text",
      }),
    ).toBe(false);
  });

  it("ignores a handle when the target cannot be resized", () => {
    expect(
      shouldBeginResize({
        handle: "se",
        tool: "select",
        targetKind: "arrow",
      }),
    ).toBe(false);
  });

  it("resizes a numbered step from a corner", () => {
    expect(
      shouldBeginResize({
        handle: "se",
        tool: "select",
        targetKind: "step",
      }),
    ).toBe(true);
    expect(
      shouldBeginResize({
        handle: "nw",
        tool: "step",
        targetKind: "step",
      }),
    ).toBe(true);
  });
});

describe("sizeControlVisible", () => {
  it("hides the size picker for the step tool or a selected step", () => {
    expect(sizeControlVisible("step", null)).toBe(false);
    expect(sizeControlVisible("select", "step")).toBe(false);
    expect(sizeControlVisible("pen", "step")).toBe(false);
  });

  it("shows the size picker for stroke and text tools", () => {
    expect(sizeControlVisible("select", null)).toBe(true);
    expect(sizeControlVisible("pen", "rectangle")).toBe(true);
    expect(sizeControlVisible("text", "text")).toBe(true);
  });
});

describe("textBodyIntent", () => {
  it("starts a move (click-without-drag still edits) for select and text tools", () => {
    expect(textBodyIntent("select")).toBe("move-or-edit");
    expect(textBodyIntent("text")).toBe("move-or-edit");
  });

  it("does not treat a text body hit as a move for other tools", () => {
    expect(textBodyIntent("arrow")).toBeNull();
    expect(textBodyIntent("eraser")).toBeNull();
  });
});

describe("stampHitIntent", () => {
  it("moves when hitting the same kind", () => {
    expect(stampHitIntent("step", "step")).toBe("move");
    expect(stampHitIntent("text", "text")).toBe("move");
  });

  it("places when hitting a different kind or nothing", () => {
    expect(stampHitIntent("step", "rectangle")).toBe("place");
    expect(stampHitIntent("step", null)).toBe("place");
    expect(stampHitIntent("text", "step")).toBe("place");
  });

  it("returns null for non-stamp tools", () => {
    expect(stampHitIntent("arrow", "arrow")).toBeNull();
  });
});

describe("textDragArmed", () => {
  it("stays a click until the pointer travels the threshold", () => {
    expect(textDragArmed({ x: 10, y: 10 }, { x: 12, y: 10 })).toBe(false);
    expect(textDragArmed({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
  });
});

describe("deleteButtonPosition", () => {
  it("centers the 18px button on the top border, horizontally in the middle", () => {
    const pos = deleteButtonPosition({ x: 100, y: 50, width: 80 }, { w: 400, h: 300 });
    const half = DELETE_BUTTON_SIZE / 2;
    expect(pos.left).toBe(100 + 80 / 2 - half);
    expect(pos.top).toBe(50 - half);
  });

  it("clamps so the button stays on the canvas", () => {
    const pos = deleteButtonPosition({ x: 2, y: 2, width: 20 }, { w: 40, h: 40 });
    expect(pos.left).toBeGreaterThanOrEqual(2);
    expect(pos.top).toBeGreaterThanOrEqual(2);
    expect(pos.left + DELETE_BUTTON_SIZE).toBeLessThanOrEqual(40);
    expect(pos.top + DELETE_BUTTON_SIZE).toBeLessThanOrEqual(40);
  });
});

describe("handleAt", () => {
  const handles = [
    { x: 10, y: 10, handle: "nw" as const },
    { x: 90, y: 10, handle: "ne" as const },
  ];

  it("hits a corner within the slop radius", () => {
    expect(handleAt(handles, { x: 12, y: 11 })).toBe("nw");
  });

  it("misses when far from every handle", () => {
    expect(handleAt(handles, { x: 50, y: 50 })).toBeNull();
  });
});

describe("cornerHandles", () => {
  it("sits on the box corners with no outward inset", () => {
    const box = { x: 40, y: 20, width: 80, height: 30 };
    expect(cornerHandles(box)).toEqual([
      { x: 40, y: 20, handle: "nw" },
      { x: 120, y: 20, handle: "ne" },
      { x: 40, y: 50, handle: "sw" },
      { x: 120, y: 50, handle: "se" },
    ]);
  });
});
