import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { createElement, type Element } from "./elements";
import {
  beginDraw,
  beginErase,
  beginMove,
  beginResize,
  beginTextEdit,
  cancelMove,
  canRedo,
  canUndo,
  color,
  editingId,
  elements,
  endDraw,
  endErase,
  endMove,
  endResize,
  endTextEdit,
  eraseAt,
  eraseLast,
  extendDraw,
  moveTo,
  redo,
  remove,
  removeLast,
  reset,
  resizeTo,
  select,
  selectedId,
  setColor,
  setStrokeSize,
  setText,
  setTool,
  strokeSize,
  tool,
  undo,
  nudgeSelection,
} from "./store";

const getElements = () => get(elements);

beforeEach(() => {
  reset();
});

describe("tool and styling", () => {
  it("switches the active tool", () => {
    setTool("pen");
    expect(get(tool)).toBe("pen");
    setTool("select");
    expect(get(tool)).toBe("select");
  });

  it("selects the text font size when the text tool activates", () => {
    setTool("rectangle");
    setStrokeSize(6);
    setTool("text");
    expect(get(strokeSize)).toBe(18);
  });

  it("sets color and stroke size", () => {
    setColor("#00ff00");
    expect(get(color)).toBe("#00ff00");
    setStrokeSize(8);
    expect(get(strokeSize)).toBe(8);
  });
});

describe("create/extend/end draw", () => {
  it("creates a shape on beginDraw and selects it", () => {
    const id = beginDraw("rectangle", { x: 10, y: 10 });
    expect(getElements()).toHaveLength(1);
    expect(get(selectedId)).toBe(id);
    extendDraw(id, { x: 40, y: 30 });
    const el = getElements()[0];
    expect(el).toMatchObject({ x: 10, y: 10, width: 30, height: 20 });
    endDraw(id);
    expect(getElements()).toHaveLength(1);
  });

  it("prunes a tiny accidental click on endDraw", () => {
    const id = beginDraw("ellipse", { x: 10, y: 10 });
    extendDraw(id, { x: 11, y: 11 });
    endDraw(id);
    expect(getElements()).toHaveLength(0);
  });

  it("keeps a single-point pen", () => {
    const id = beginDraw("pen", { x: 10, y: 10 });
    endDraw(id);
    expect(getElements()).toHaveLength(1);
    expect(getElements()[0]).toMatchObject({ kind: "pen", points: [{ x: 10, y: 10 }] });
    expect(get(selectedId)).toBeNull();
  });

  it("keeps a single-point penArrow and does not invent a head", () => {
    const id = beginDraw("penArrow", { x: 4, y: 6 });
    endDraw(id);
    const el = getElements()[0];
    expect(el.kind).toBe("penArrow");
    if (el.kind === "penArrow") expect(el.points).toEqual([{ x: 4, y: 6 }]);
    expect(get(selectedId)).toBeNull();
  });

  it("still prunes a single-point highlight", () => {
    const id = beginDraw("highlight", { x: 10, y: 10 });
    endDraw(id);
    expect(getElements()).toHaveLength(0);
  });

  it("keeps a multi-point pen selected", () => {
    const id = beginDraw("pen", { x: 10, y: 10 });
    extendDraw(id, { x: 12, y: 10 });
    extendDraw(id, { x: 40, y: 12 });
    endDraw(id);
    expect(getElements()).toHaveLength(1);
    expect(get(selectedId)).toBe(id);
  });

  it("leaves no phantom undo step after a tiny draw is pruned", () => {
    const id = beginDraw("ellipse", { x: 10, y: 10 });
    extendDraw(id, { x: 11, y: 11 });
    endDraw(id);
    expect(getElements()).toHaveLength(0);
    expect(get(canUndo)).toBe(false);
    undo();
    expect(getElements()).toHaveLength(0);
    expect(get(canRedo)).toBe(false);
  });

  it("records undo for a single-point pen", () => {
    const id = beginDraw("pen", { x: 10, y: 10 });
    endDraw(id);
    expect(getElements()).toHaveLength(1);
    expect(get(canUndo)).toBe(true);
    undo();
    expect(getElements()).toHaveLength(0);
  });

  it("leaves no phantom undo step after an empty text is pruned", () => {
    const id = beginDraw("text", { x: 5, y: 6 });
    endTextEdit();
    expect(getElements()).toHaveLength(0);
    expect(get(canUndo)).toBe(false);
  });

  it("keeps the undo stack balanced after a prune followed by a real draw", () => {
    const tiny = beginDraw("ellipse", { x: 10, y: 10 });
    endDraw(tiny);
    const real = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(real, { x: 20, y: 20 });
    endDraw(real);
    expect(getElements()).toHaveLength(1);
    undo();
    expect(getElements()).toHaveLength(0);
    expect(get(canUndo)).toBe(false);
  });

  it("records an undo step per committed draw", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    expect(getElements()).toHaveLength(1);
    undo();
    expect(getElements()).toHaveLength(0);
    redo();
    expect(getElements()).toHaveLength(1);
  });
});

describe("undo/redo", () => {
  it("cycles undo and redo", () => {
    const a = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(a, { x: 20, y: 20 });
    endDraw(a);
    const b = beginDraw("ellipse", { x: 5, y: 5 });
    extendDraw(b, { x: 25, y: 25 });
    endDraw(b);
    expect(getElements()).toHaveLength(2);
    undo();
    expect(getElements()).toHaveLength(1);
    undo();
    expect(getElements()).toHaveLength(0);
    expect(get(canUndo)).toBe(false);
    redo();
    expect(getElements()).toHaveLength(1);
    redo();
    expect(getElements()).toHaveLength(2);
    expect(get(canRedo)).toBe(false);
  });

  it("clears the redo stack on a new mutation", () => {
    const a = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(a, { x: 20, y: 20 });
    endDraw(a);
    undo();
    expect(get(canRedo)).toBe(true);
    const b = beginDraw("ellipse", { x: 0, y: 0 });
    extendDraw(b, { x: 20, y: 20 });
    endDraw(b);
    expect(get(canRedo)).toBe(false);
  });

  it("is a no-op at the start of the stack", () => {
    undo();
    expect(getElements()).toHaveLength(0);
    expect(get(canUndo)).toBe(false);
  });
});

describe("move", () => {
  it("moves an element by the pointer delta from drag start", () => {
    const id = beginDraw("rectangle", { x: 10, y: 10 });
    extendDraw(id, { x: 40, y: 30 });
    endDraw(id);
    beginMove(id, { x: 25, y: 20 });
    moveTo(id, { x: 45, y: 10 });
    const el = getElements()[0];
    expect(el).toMatchObject({ x: 30, y: 0 });
    moveTo(id, { x: 25, y: 20 });
    expect(getElements()[0]).toMatchObject({ x: 10, y: 10 });
    endMove();
  });

  it("is undoable as one step", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    beginMove(id, { x: 0, y: 0 });
    moveTo(id, { x: 50, y: 50 });
    endMove();
    undo();
    expect(getElements()[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("cancelMove drops the unused undo snapshot from a click that never dragged", () => {
    const id = beginDraw("text", { x: 10, y: 10 });
    endDraw(id);
    beginMove(id, { x: 10, y: 10 });
    cancelMove();
    undo();
    expect(getElements()).toHaveLength(0);
  });
});

describe("resize", () => {
  it("resizes a shape from the se handle", () => {
    const id = beginDraw("rectangle", { x: 10, y: 10 });
    extendDraw(id, { x: 40, y: 30 });
    endDraw(id);
    beginResize(id, "se", { x: 40, y: 30 });
    resizeTo(id, { x: 55, y: 50 });
    endResize();
    expect(getElements()[0]).toMatchObject({ x: 10, y: 10, width: 45, height: 40 });
  });

  it("draws a square rectangle when shift-constrained", () => {
    const id = beginDraw("rectangle", { x: 10, y: 10 });
    extendDraw(id, { x: 40, y: 25 }, true);
    endDraw(id);
    expect(getElements()[0]).toMatchObject({ x: 10, y: 10, width: 30, height: 30 });
  });

  it("shift-resizes an ellipse into a circle from se", () => {
    const id = beginDraw("ellipse", { x: 10, y: 10 });
    extendDraw(id, { x: 110, y: 60 });
    endDraw(id);
    beginResize(id, "se", { x: 110, y: 60 });
    resizeTo(id, { x: 115, y: 68 }, undefined, true);
    endResize();
    expect(getElements()[0]).toMatchObject({ x: 10, y: 10, width: 105, height: 105 });
  });

  it("resizes a text element width", () => {
    const p = { x: 10, y: 10 };
    const el = createElement("text", p, "#000", 18) as Element;
    elements.set([el]);
    beginResize(el.id, "e", p);
    resizeTo(el.id, { x: 80, y: 10 });
    const after = getElements()[0] as any;
    expect(after.width).toBeGreaterThan(0);
  });
});

describe("delete", () => {
  it("removes a specific element", () => {
    const a = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(a, { x: 20, y: 20 });
    endDraw(a);
    const b = beginDraw("ellipse", { x: 0, y: 0 });
    extendDraw(b, { x: 20, y: 20 });
    endDraw(b);
    remove(a);
    expect(getElements()).toHaveLength(1);
    expect(getElements()[0].id).toBe(b);
    expect(get(selectedId)).toBe(b);
  });

  it("removes the last element when nothing is selected", () => {
    const a = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(a, { x: 20, y: 20 });
    endDraw(a);
    const b = beginDraw("ellipse", { x: 0, y: 0 });
    extendDraw(b, { x: 20, y: 20 });
    endDraw(b);
    removeLast();
    expect(getElements().map((e) => e.id)).toEqual([a]);
  });

  it("is undoable", () => {
    const a = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(a, { x: 20, y: 20 });
    endDraw(a);
    remove(a);
    expect(getElements()).toHaveLength(0);
    undo();
    expect(getElements()).toHaveLength(1);
  });
});

describe("text editing", () => {
  it("places a text element and enters edit mode", () => {
    const id = beginDraw("text", { x: 5, y: 6 });
    expect(get(editingId)).toBe(id);
    const el = getElements()[0];
    expect(el.kind).toBe("text");
    setText(id, "hello");
    expect(getElements()[0]).toMatchObject({ text: "hello" });
    endTextEdit();
    expect(get(editingId)).toBeNull();
    expect(getElements()).toHaveLength(1);
  });

  it("prunes an empty text on commit", () => {
    const id = beginDraw("text", { x: 5, y: 6 });
    endTextEdit();
    expect(getElements()).toHaveLength(0);
  });

  it("edits text with a single undo step", () => {
    const id = beginDraw("text", { x: 5, y: 6 });
    setText(id, "v1");
    endTextEdit();
    beginTextEdit(id);
    setText(id, "v2");
    endTextEdit();
    undo();
    const el = getElements()[0];
    expect(el.kind === "text" ? el.text : "").toBe("v1");
  });
});

describe("selection", () => {
  it("selects and deselects", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    select(null);
    expect(get(selectedId)).toBeNull();
    select(id);
    expect(get(selectedId)).toBe(id);
  });
});

describe("reset", () => {
  it("clears elements, history and selection", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    setTool("pen");
    reset();
    expect(getElements()).toHaveLength(0);
    expect(get(canUndo)).toBe(false);
    expect(get(canRedo)).toBe(false);
    expect(get(selectedId)).toBeNull();
    expect(get(tool)).toBe("select");
  });
});

describe("erase gesture", () => {
  function threeShapes(): [number, number, number] {
    const a = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(a, { x: 10, y: 10 });
    endDraw(a);
    const b = beginDraw("ellipse", { x: 30, y: 30 });
    extendDraw(b, { x: 40, y: 40 });
    endDraw(b);
    const c = beginDraw("pen", { x: 60, y: 60 });
    extendDraw(c, { x: 70, y: 70 });
    endDraw(c);
    expect(getElements()).toHaveLength(3);
    return [a, b, c];
  }

  it("erases a whole drag in a single undo step", () => {
    const [a, b, c] = threeShapes();
    beginErase();
    eraseAt(a);
    eraseAt(b);
    eraseAt(c);
    expect(endErase()).toBe(true);
    expect(getElements()).toHaveLength(0);
    undo();
    expect(getElements()).toHaveLength(3);
  });

  it("eraseLast removes the top element inside a gesture", () => {
    const [a, b, c] = threeShapes();
    void a;
    void b;
    beginErase();
    eraseLast();
    expect(endErase()).toBe(true);
    expect(getElements().map((e) => e.id)).toEqual([a, b]);
    void c;
    undo();
    expect(getElements()).toHaveLength(3);
  });

  it("leaves no phantom undo step when nothing was erased", () => {
    threeShapes();
    beginErase();
    expect(endErase()).toBe(false);
    undo();
    expect(getElements()).toHaveLength(2);
  });

  it("ignores erase calls outside a gesture", () => {
    const [a] = threeShapes();
    eraseAt(a);
    eraseLast();
    expect(getElements()).toHaveLength(3);
  });

  it("clears erase state on reset so the next gesture snapshots", () => {
    const [stale] = threeShapes();
    void stale;
    beginErase();
    reset();
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    beginErase();
    eraseAt(id);
    expect(endErase()).toBe(true);
    expect(getElements()).toHaveLength(0);
    undo();
    expect(getElements()).toHaveLength(1);
  });
});

describe("numbered steps", () => {
  function stepNumbers(): number[] {
    return getElements()
      .filter((e): e is Element & { kind: "step" } => e.kind === "step")
      .map((e) => e.stepNumber);
  }

  function placeSteps(count: number): number[] {
    setTool("step");
    setStrokeSize(24);
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = beginDraw("step", { x: i * 30, y: 10 });
      endDraw(id);
      ids.push(id);
    }
    return ids;
  }

  it("assigns sequential stepNumbers on placement", () => {
    placeSteps(2);
    expect(stepNumbers()).toEqual([1, 2]);
  });

  it("reuses the last number after undo removes the latest step", () => {
    placeSteps(2);
    undo();
    const id = beginDraw("step", { x: 60, y: 10 });
    endDraw(id);
    expect(stepNumbers()).toEqual([1, 2]);
  });

  it("compacts after remove and assigns the next number", () => {
    const [a, b, c] = placeSteps(3);
    remove(b);
    expect(stepNumbers()).toEqual([1, 2]);
    const id = beginDraw("step", { x: 90, y: 10 });
    endDraw(id);
    expect(stepNumbers()).toEqual([1, 2, 3]);
    void a;
    void c;
  });

  it("compacts after erase gesture and undo restores original sequence", () => {
    const [a, b, c] = placeSteps(3);
    beginErase();
    eraseAt(b);
    expect(endErase()).toBe(true);
    expect(stepNumbers()).toEqual([1, 2]);
    undo();
    expect(stepNumbers()).toEqual([1, 2, 3]);
    void a;
    void c;
  });

  it("starts at 1 after reset", () => {
    placeSteps(2);
    reset();
    const id = beginDraw("step", { x: 0, y: 0 });
    endDraw(id);
    expect(stepNumbers()).toEqual([1]);
  });

  it("setStrokeSize does not resize existing step badges", () => {
    placeSteps(2);
    select(null);
    setStrokeSize(32);
    expect(getElements().filter((e) => e.kind === "step").every((e) => e.size === 24)).toBe(true);
    const [first] = getElements();
    setTool("select");
    select(first.id);
    setStrokeSize(14);
    expect(getElements().filter((e) => e.kind === "step").every((e) => e.size === 24)).toBe(true);
  });

  it("handle-resizing one step broadcasts size to the whole series as one undo", () => {
    const [first] = placeSteps(2);
    setTool("select");
    select(first);
    beginResize(first, "se", { x: 0, y: 0 });
    resizeTo(first, { x: 20.4, y: 20.4 });
    endResize();
    const sizes = getElements().filter((e) => e.kind === "step").map((e) => e.size);
    expect(sizes).toEqual([48, 48]);
    undo();
    expect(getElements().filter((e) => e.kind === "step").every((e) => e.size === 24)).toBe(true);
  });

  it("stores the scaled series size for the next stamp", () => {
    const [first] = placeSteps(1);
    beginResize(first, "se", { x: 0, y: 0 });
    resizeTo(first, { x: 20.4, y: 20.4 });
    endResize();
    setTool("step");
    const id = beginDraw("step", { x: 80, y: 10 });
    endDraw(id);
    expect(getElements().find((e) => e.id === id)!.size).toBe(48);
  });

  it("does not snapshot when resizing with no steps on canvas", () => {
    setTool("step");
    setStrokeSize(32);
    expect(get(canUndo)).toBe(false);
    const id = beginDraw("step", { x: 0, y: 0 });
    endDraw(id);
    expect(getElements().find((e) => e.id === id)!.size).toBe(32);
  });
});

describe("styling the selection", () => {
  beforeEach(() => {
    select(null);
    setColor("#ef4444");
  });

  it("setColor with a selection changes that element and the color store", () => {
    const id = beginDraw("arrow", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    const original = getElements()[0].color;
    setColor("#abcdef");
    expect(get(color)).toBe("#abcdef");
    expect(getElements()[0].color).toBe("#abcdef");
    expect(original).not.toBe("#abcdef");
  });

  it("setColor with nothing selected changes only the store", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    const original = getElements()[0].color;
    select(null);
    setColor("#abcdef");
    expect(get(color)).toBe("#abcdef");
    expect(getElements()[0].color).toBe(original);
  });

  it("setColor with a selection is undoable as one step", () => {
    const id = beginDraw("arrow", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    const original = getElements()[0].color;
    setColor("#abcdef");
    expect(getElements()[0].color).toBe("#abcdef");
    undo();
    expect(getElements()[0].color).toBe(original);
  });

  it("setColor with nothing selected pushes no undo step", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    select(null);
    undo();
    expect(get(canUndo)).toBe(false);
    setColor("#00ff00");
    expect(get(canUndo)).toBe(false);
  });

  it("setStrokeSize with a text element selected changes its size", () => {
    const id = beginDraw("text", { x: 5, y: 6 });
    setText(id, "hello");
    endTextEdit();
    select(id);
    setStrokeSize(32);
    const el = getElements()[0];
    expect(el.kind).toBe("text");
    expect(el.size).toBe(32);
  });

  it("setTool with an element selected does not change that element's size", () => {
    setTool("rectangle");
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    const before = getElements()[0].size;
    setTool("text");
    expect(getElements()[0].size).toBe(before);
  });

  it("nudgeSelection offsets the selected element by exactly the delta", () => {
    const id = beginDraw("rectangle", { x: 10, y: 10 });
    extendDraw(id, { x: 40, y: 30 });
    endDraw(id);
    nudgeSelection(1, 0);
    expect(getElements()[0]).toMatchObject({ x: 11, y: 10 });
  });

  it("nudgeSelection with nothing selected is a no-op and adds no undo step", () => {
    const id = beginDraw("rectangle", { x: 10, y: 10 });
    extendDraw(id, { x: 40, y: 30 });
    endDraw(id);
    select(null);
    const before = structuredClone(getElements()[0]);
    const undoBefore = get(canUndo);
    nudgeSelection(5, 5);
    expect(getElements()[0]).toEqual(before);
    expect(get(canUndo)).toBe(undoBefore);
  });

  it("nudgeSelection is undoable as one step", () => {
    const id = beginDraw("rectangle", { x: 0, y: 0 });
    extendDraw(id, { x: 20, y: 20 });
    endDraw(id);
    nudgeSelection(8, -3);
    expect(getElements()[0]).toMatchObject({ x: 8, y: -3 });
    undo();
    expect(getElements()[0]).toMatchObject({ x: 0, y: 0 });
  });
});
