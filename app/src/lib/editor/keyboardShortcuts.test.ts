import { describe, expect, it } from "vitest";
import {
  neighborSize,
  resolveShortcut,
  sizeOptionsFor,
  STROKE_SIZES,
  TEXT_SIZES,
  type EditorAction,
  type KeyEventLike,
  type ShortcutContext,
} from "./keyboardShortcuts";

function key(
  overrides: Partial<KeyEventLike> & { key: string; altKey?: boolean },
): KeyEventLike {
  return { metaKey: false, ctrlKey: false, shiftKey: false, ...overrides };
}

const CTX: ShortcutContext = { tool: "select", editing: false };
const EDITING: ShortcutContext = { tool: "select", editing: true };

function resolve(k: KeyEventLike, ctx = CTX): EditorAction {
  const action = resolveShortcut(k, ctx);
  if (!action) throw new Error(`expected an action for ${JSON.stringify(k)}`);
  return action;
}

describe("undo/redo ladder", () => {
  it("maps Cmd/Ctrl+Z to undo, even while editing", () => {
    expect(resolve(key({ key: "z", metaKey: true }))).toEqual({ kind: "undo" });
    expect(resolve(key({ key: "z", ctrlKey: true }))).toEqual({ kind: "undo" });
    expect(resolve(key({ key: "z", metaKey: true }), EDITING)).toEqual({ kind: "undo" });
  });

  it("maps Cmd/Ctrl+Shift+Z to redo (uppercase key still matches)", () => {
    expect(resolve(key({ key: "z", metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
    expect(resolve(key({ key: "Z", ctrlKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
    expect(resolve(key({ key: "Z", metaKey: true, shiftKey: true }), EDITING)).toEqual({
      kind: "redo",
    });
  });

  it("does not bind plain z", () => {
    expect(resolveShortcut(key({ key: "z" }), CTX)).toBe(null);
  });
});

describe("output actions", () => {
  it("binds Cmd/Ctrl+C to copy regardless of editing mode", () => {
    expect(resolve(key({ key: "c", metaKey: true }))).toEqual({
      kind: "output",
      output: "copy",
    });
    expect(resolve(key({ key: "c", ctrlKey: true }), EDITING)).toEqual({
      kind: "output",
      output: "copy",
    });
  });

  it("binds Cmd/Ctrl+S to save", () => {
    expect(resolve(key({ key: "s", metaKey: true }))).toEqual({ kind: "output", output: "save" });
    expect(resolve(key({ key: "s", ctrlKey: true }), EDITING)).toEqual({
      kind: "output",
      output: "save",
    });
  });

  it("gives Cmd+C precedence over the eyedropper c binding", () => {
    const action = resolve(
      key({ key: "c", metaKey: true }),
      { tool: "eyedropper", editing: false },
    );
    expect(action).toEqual({ kind: "output", output: "copy" });
  });

  it("never binds a keyboard shortcut to copyAndSave (button-only)", () => {
    for (const k of ["a", "c", "d", "s", "p", "Enter"]) {
      const action = resolveShortcut(key({ key: k }), CTX);
      expect(action?.kind !== "output" || action.output !== "copyAndSave").toBe(true);
    }
    const modAction = resolveShortcut(key({ key: "d", metaKey: true }), CTX);
    expect(modAction?.kind !== "output" || modAction.output !== "copyAndSave").toBe(true);
  });
});

describe("eyedropper color copy", () => {
  it("binds plain c only with the eyedropper active and no edit open", () => {
    expect(
      resolve(key({ key: "c" }), { tool: "eyedropper", editing: false }),
    ).toEqual({ kind: "pickEyedropperColor" });
    expect(resolveShortcut(key({ key: "c" }), { tool: "eyedropper", editing: true })).toBe(null);
    expect(resolveShortcut(key({ key: "c" }), { tool: "pen", editing: false })).toBe(null);
    expect(resolveShortcut(key({ key: "C" }), { tool: "eyedropper", editing: false })).toEqual({
      kind: "pickEyedropperColor",
    });
  });
});

describe("escape ladder entry", () => {
  it("fires Escape in every mode — the page owns the cascade order", () => {
    expect(resolve(key({ key: "Escape" }))).toEqual({ kind: "escape" });
    expect(resolve(key({ key: "Escape" }), EDITING)).toEqual({ kind: "escape" });
    expect(resolve(key({ key: "Escape" }), { tool: "pen", editing: false })).toEqual({
      kind: "escape",
    });
  });

  it("Escape is not shadowed by modifier state", () => {
    expect(resolve(key({ key: "Escape", shiftKey: true }))).toEqual({ kind: "escape" });
    expect(resolve(key({ key: "Escape", metaKey: true }))).toEqual({ kind: "escape" });
  });
});

describe("delete selection bypass rules", () => {
  it("binds Delete/Backspace when not editing", () => {
    expect(resolve(key({ key: "Delete" }))).toEqual({ kind: "deleteSelection" });
    expect(resolve(key({ key: "Backspace" }))).toEqual({ kind: "deleteSelection" });
  });

  it("bypasses entirely while text editing (no action, no preventDefault)", () => {
    expect(resolveShortcut(key({ key: "Delete" }), EDITING)).toBe(null);
    expect(resolveShortcut(key({ key: "Backspace" }), EDITING)).toBe(null);
  });
});

describe("size steppers [ and ]", () => {
  it("steps sizes down/up only outside editing mode and without modifiers", () => {
    expect(resolve(key({ key: "[" }))).toEqual({ kind: "shrinkSize" });
    expect(resolve(key({ key: "]" }))).toEqual({ kind: "growSize" });
    expect(resolveShortcut(key({ key: "[" }), EDITING)).toBe(null);
    expect(resolveShortcut(key({ key: "]" }), EDITING)).toBe(null);
    expect(resolveShortcut(key({ key: "[", metaKey: true }), CTX)).toBe(null);
    expect(resolveShortcut(key({ key: "]", ctrlKey: true }), CTX)).toBe(null);
  });

  it("shifted braces do not match the raw-key binding", () => {
    expect(resolveShortcut(key({ key: "{" }), CTX)).toBe(null);
    expect(resolveShortcut(key({ key: "}" }), CTX)).toBe(null);
  });
});

describe("single-key tool switching", () => {
  const EXPECTED: Array<[string, string]> = [
    ["v", "select"],
    ["t", "text"],
    ["a", "arrow"],
    ["r", "rectangle"],
    ["e", "ellipse"],
    ["p", "pen"],
    ["f", "penArrow"],
    ["h", "highlight"],
    ["b", "blur"],
    ["x", "eraser"],
    ["d", "eraser"],
    ["i", "eyedropper"],
  ];

  it("maps every tool key exactly as the original ladder", () => {
    for (const [k, tool] of EXPECTED) {
      expect(resolve(key({ key: k }))).toEqual({ kind: "selectTool", tool });
      expect(resolve(key({ key: k.toUpperCase() }))).toEqual({ kind: "selectTool", tool });
    }
  });

  it("is bypassed while editing or when modifiers are held", () => {
    for (const [k] of EXPECTED) {
      expect(
        resolveShortcut(key({ key: k }), { tool: "select", editing: true }),
      ).toBe(null);
      expect(resolveShortcut(key({ key: k, metaKey: true }), CTX)).toBe(null);
      expect(resolveShortcut(key({ key: k, ctrlKey: true }), CTX)).toBe(null);
    }
  });

  it("keeps non-tool letters unbound", () => {
    for (const k of ["q", "w", "g", "j", "k", "l", "n", "o", "u", "y", "1"]) {
      expect(resolveShortcut(key({ key: k }), CTX)).toBe(null);
    }
  });
});

describe("unbound keys", () => {
  it("returns null so callers skip preventDefault", () => {
    expect(resolveShortcut(key({ key: "F1" }), CTX)).toBe(null);
    expect(resolveShortcut(key({ key: "Enter" }), CTX)).toBe(null);
    expect(resolveShortcut(key({ key: "Tab" }), CTX)).toBe(null);
    expect(resolveShortcut(key({ key: "a", altKey: true }), CTX)).toEqual({
      kind: "selectTool",
      tool: "arrow",
    });
  });
});

describe("nudge and newly surfaced shortcuts", () => {
  it("maps s to the numbered-step tool", () => {
    expect(resolve(key({ key: "s" }))).toEqual({ kind: "selectTool", tool: "step" });
  });

  it("swallows s while text editing", () => {
    expect(resolveShortcut(key({ key: "s" }), EDITING)).toBe(null);
  });

  it("maps arrow keys to 1px nudges", () => {
    expect(resolve(key({ key: "ArrowLeft" }))).toEqual({ kind: "nudge", dx: -1, dy: 0 });
    expect(resolve(key({ key: "ArrowDown" }))).toEqual({ kind: "nudge", dx: 0, dy: 1 });
  });

  it("maps Shift+arrow to a 10px nudge", () => {
    expect(resolve(key({ key: "ArrowRight", shiftKey: true }))).toEqual({
      kind: "nudge",
      dx: 10,
      dy: 0,
    });
  });

  it("does not nudge while text editing", () => {
    expect(resolveShortcut(key({ key: "ArrowUp" }), EDITING)).toBe(null);
  });

  it("leaves modifier arrows unbound", () => {
    expect(resolveShortcut(key({ key: "ArrowLeft", metaKey: true }), CTX)).toBe(null);
  });

  it("maps Cmd+Shift+C to copyAndSave without shadowing Cmd+C", () => {
    expect(resolve(key({ key: "c", metaKey: true, shiftKey: true }))).toEqual({
      kind: "output",
      output: "copyAndSave",
    });
    expect(resolve(key({ key: "c", metaKey: true }))).toEqual({
      kind: "output",
      output: "copy",
    });
  });

  it("leaves the eyedropper c binding intact", () => {
    expect(resolve(key({ key: "c" }), { tool: "eyedropper", editing: false })).toEqual({
      kind: "pickEyedropperColor",
    });
  });
});

describe("neighborSize", () => {
  const SIZES = [2, 4, 6, 8];

  it("steps to the previous/next entry from a listed size", () => {
    expect(neighborSize(SIZES, 4, -1)).toBe(2);
    expect(neighborSize(SIZES, 4, 1)).toBe(6);
    expect(neighborSize(SIZES, 8, 1)).toBeNull();
    expect(neighborSize(SIZES, 2, -1)).toBeNull();
  });

  it("snaps unlisted currents to the nearest end like the old fallback", () => {
    expect(neighborSize(SIZES, 5, -1)).toBe(2);
    expect(neighborSize(SIZES, 5, 1)).toBe(8);
  });

  it("yields null for empty lists in both directions", () => {
    expect(neighborSize([], 4, -1)).toBeNull();
    expect(neighborSize([], 4, 1)).toBeNull();
  });

  it("matches the real stroke and text tables end-to-end", () => {
    expect(neighborSize(STROKE_SIZES, 12, 1)).toBeNull();
    expect(neighborSize(STROKE_SIZES, 12, -1)).toBe(8);
    expect(neighborSize(TEXT_SIZES, 14, -1)).toBeNull();
    expect(neighborSize(TEXT_SIZES, 48, 1)).toBeNull();
  });
});

describe("sizeOptionsFor", () => {
  it("uses text sizes only for the text/step tools", () => {
    expect(sizeOptionsFor("text")).toBe(TEXT_SIZES);
    expect(sizeOptionsFor("step")).toBe(TEXT_SIZES);
    for (const t of ["select", "eraser", "eyedropper", "arrow", "blur", "penArrow"] as const) {
      expect(sizeOptionsFor(t)).toBe(STROKE_SIZES);
    }
  });
});
