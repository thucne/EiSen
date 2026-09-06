import type { Tool } from "./elements";

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutContext {
  /** Currently active annotation tool. */
  tool: Tool;
  /** True while an inline text edit is open (`$editingId != null`); most
   *  shortcuts must bypass while it lasts, mirroring the original ladder. */
  editing: boolean;
}

export type OutputAction = "copy" | "save" | "copyAndSave";

/** Resolved intent for a keydown; the editor page maps these onto its
 *  existing handlers (including which branches call preventDefault). */
export type EditorAction =
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "output"; output: OutputAction }
  | { kind: "pickEyedropperColor" }
  | { kind: "escape" }
  | { kind: "deleteSelection" }
  | { kind: "shrinkSize" }
  | { kind: "growSize" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "selectTool"; tool: Tool };

export const STROKE_SIZES = [2, 4, 6, 8, 12];
export const TEXT_SIZES = [14, 18, 24, 32, 48];

export function sizeOptionsFor(t: Tool): number[] {
  return t === "text" || t === "step" ? TEXT_SIZES : STROKE_SIZES;
}

/** Neighbouring entry inside `opts` for the [ (previous) / ] (next) size
 *  steppers. An unlisted `current` snaps to the nearest end; boundaries and
 *  empty lists yield null (no-op), matching the original inline logic. */
export function neighborSize(
  opts: readonly number[],
  current: number,
  direction: -1 | 1,
): number | null {
  const idx = opts.indexOf(current);
  if (direction === -1) {
    if (idx > 0) return opts[idx - 1];
    if (idx === -1 && opts.length > 0) return opts[0];
    return null;
  }
  if (idx >= 0 && idx < opts.length - 1) return opts[idx + 1];
  if (idx === -1 && opts.length > 0) return opts[opts.length - 1];
  return null;
}

interface NormalizedKey {
  /** Single characters lowercased (so Shift+Z still matches "z"); named
   *  keys like "Escape"/"Delete" stay raw, exactly like the old ladder. */
  key: string;
  mod: boolean;
  shift: boolean;
}

function normalize(e: KeyEventLike): NormalizedKey {
  return {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
  };
}

const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: "select",
  t: "text",
  a: "arrow",
  r: "rectangle",
  e: "ellipse",
  p: "pen",
  h: "highlight",
  f: "penArrow",
  b: "blur",
  x: "eraser",
  d: "eraser",
  i: "eyedropper",
  s: "step",
};

interface ShortcutRule {
  when: (k: NormalizedKey, ctx: ShortcutContext) => boolean;
  action: (k: NormalizedKey) => EditorAction;
}

const NUDGE_KEYS: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};
const NUDGE_COARSE = 10;

/** Ordered match table — order mirrors the historical if-ladder because
 *  earlier rules win (e.g. Cmd+C beats the eyedropper "c" binding). */
const RULES: ShortcutRule[] = [
  { when: (k) => k.mod && k.key === "z" && k.shift, action: () => ({ kind: "redo" }) },
  { when: (k) => k.mod && k.key === "z", action: () => ({ kind: "undo" }) },
  { when: (k) => k.mod && k.key === "c" && k.shift, action: () => ({ kind: "output", output: "copyAndSave" }) },
  { when: (k) => k.mod && k.key === "c", action: () => ({ kind: "output", output: "copy" }) },
  {
    when: (k, ctx) => !k.mod && k.key === "c" && ctx.tool === "eyedropper" && !ctx.editing,
    action: () => ({ kind: "pickEyedropperColor" }),
  },
  { when: (k) => k.mod && k.key === "s", action: () => ({ kind: "output", output: "save" }) },
  { when: (k) => k.key === "Escape", action: () => ({ kind: "escape" }) },
  {
    when: (k, ctx) => (k.key === "Delete" || k.key === "Backspace") && !ctx.editing,
    action: () => ({ kind: "deleteSelection" }),
  },
  {
    when: (k, ctx) => !k.mod && !ctx.editing && k.key === "[",
    action: () => ({ kind: "shrinkSize" }),
  },
  {
    when: (k, ctx) => !k.mod && !ctx.editing && k.key === "]",
    action: () => ({ kind: "growSize" }),
  },
  {
    when: (k, ctx) => !k.mod && !ctx.editing && k.key in NUDGE_KEYS,
    action: (k) => {
      const d = NUDGE_KEYS[k.key];
      const m = k.shift ? NUDGE_COARSE : 1;
      return { kind: "nudge", dx: d.dx * m, dy: d.dy * m };
    },
  },
  {
    when: (k, ctx) => !k.mod && !ctx.editing && k.key in TOOL_KEYS,
    action: (k) => ({ kind: "selectTool", tool: TOOL_KEYS[k.key] }),
  },
];

/** Resolves a keydown against the editor shortcut table. Returns null when
 *  no binding applies; callers must not preventDefault in that case. */
export function resolveShortcut(
  e: KeyEventLike,
  ctx: ShortcutContext,
): EditorAction | null {
  const k = normalize(e);
  for (const rule of RULES) {
    if (rule.when(k, ctx)) return rule.action(k);
  }
  return null;
}
