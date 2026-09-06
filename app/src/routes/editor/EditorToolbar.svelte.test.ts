import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorToolbar from "./EditorToolbar.svelte";
import { en } from "$lib/i18n/en";
import { vi as viDict } from "$lib/i18n/vi";
import { setLang } from "$lib/i18n";

function renderToolbar(props: Partial<Record<string, unknown>> = {}) {
  const handlers = {
    onselect: vi.fn(),
    onpickcolor: vi.fn(),
    onpicksize: vi.fn(),
    onundo: vi.fn(),
    onredo: vi.fn(),
    ontogglecolors: vi.fn(),
    ontogglesizes: vi.fn(),
    ontogglecollapsed: vi.fn(),
  };
  const result = render(EditorToolbar, {
    props: {
      tool: "select",
      color: "#ef4444",
      strokeSize: 4,
      canUndo: true,
      canRedo: false,
      collapsed: false,
      showColors: false,
      showSizes: false,
      ...handlers,
      ...props,
    },
  });
  return { ...result, handlers };
}

beforeEach(() => {
  setLang("en");
});

describe("EditorToolbar", () => {
  it("renders one button per annotation tool and reports selections", async () => {
    const { handlers } = renderToolbar();
    for (const title of [
      `${en.tools.select} (V)`,
      `${en.tools.eyedropper} (I)`,
      `${en.tools.text} (T)`,
      `${en.tools.step} (S)`,
      `${en.tools.arrow} (A)`,
      `${en.tools.rectangle} (R)`,
      `${en.tools.ellipse} (E)`,
      `${en.tools.pen} (P)`,
      `${en.tools.penArrow} (F)`,
      `${en.tools.highlight} (H)`,
      `${en.tools.blur} (B)`,
      `${en.tools.eraser} (X)`,
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeTruthy();
    }
    await fireEvent.click(screen.getByRole("button", { name: `${en.tools.rectangle} (R)` }));
    await fireEvent.click(screen.getByRole("button", { name: `${en.tools.eyedropper} (I)` }));
    await fireEvent.click(screen.getByRole("button", { name: `${en.tools.penArrow} (F)` }));
    expect(handlers.onselect).toHaveBeenNthCalledWith(1, "rectangle");
    expect(handlers.onselect).toHaveBeenNthCalledWith(2, "eyedropper");
    expect(handlers.onselect).toHaveBeenNthCalledWith(3, "penArrow");
  });

  it("draws pen and pen-arrow as the same freehand stroke, with a head only on pen-arrow", () => {
    renderToolbar();
    const penPaths = screen.getByRole("button", { name: `${en.tools.pen} (P)` }).querySelectorAll("path");
    const arrowPaths = screen.getByRole("button", { name: `${en.tools.penArrow} (F)` }).querySelectorAll("path");
    expect(penPaths).toHaveLength(1);
    expect(arrowPaths).toHaveLength(2);
    expect(arrowPaths[0].getAttribute("d")).toBe(penPaths[0].getAttribute("d"));
    expect(arrowPaths[1].getAttribute("fill")).toBe("currentColor");
  });

  it("places markup tools left of pen, and the eyedropper beside the color palette", () => {
    const { container } = renderToolbar();
    const tips = [...container.querySelectorAll(".floating-toolbar:not(.collapsed) [data-tip]")].map(
      (el) => el.getAttribute("data-tip"),
    );
    const i = (name: string) => tips.indexOf(name);
    expect(i(`${en.tools.highlight} (H)`)).toBeLessThan(i(`${en.tools.blur} (B)`));
    expect(i(`${en.tools.blur} (B)`)).toBeLessThan(i(`${en.tools.arrow} (A)`));
    expect(i(`${en.tools.arrow} (A)`)).toBe(i(`${en.tools.text} (T)`) - 1);
    expect(i(`${en.tools.text} (T)`)).toBe(i(`${en.tools.pen} (P)`) - 1);
    expect(i(`${en.tools.pen} (P)`)).toBe(i(`${en.tools.penArrow} (F)`) - 1);
    expect(i(`${en.tools.eyedropper} (I)`)).toBe(i(en.actions.colorPalette) - 1);
  });

  it("marks the active tool, color badge, and stroke size from props", () => {
    const { container } = renderToolbar({
      tool: "pen",
      color: "#06b6d4",
      strokeSize: 12,
    });
    const active = container.querySelector(".tb-btn.active");
    expect(active?.getAttribute("data-tip")).toBe(`${en.tools.pen} (P)`);
    const badge = container.querySelector(".color-badge") as HTMLElement;
    expect(badge?.style.background).toBe("#06b6d4");
    const sizeText = container.querySelector(".size-text");
    expect(sizeText?.textContent).toBe("12px");
  });

  it("emits color/size picks and closes nothing itself (page owns popovers)", async () => {
    const { handlers } = renderToolbar({ showColors: true, showSizes: true });
    await fireEvent.click(screen.getByRole("button", { name: "#eab308" }));
    await fireEvent.click(screen.getByRole("button", { name: "8px" }));
    expect(handlers.onpickcolor).toHaveBeenCalledWith("#eab308");
    expect(handlers.onpicksize).toHaveBeenCalledWith(8);
  });

  it("toggles popovers through callbacks", async () => {
    const { handlers } = renderToolbar({ showColors: true });
    await fireEvent.click(screen.getByRole("button", { name: en.actions.colorPalette }));
    await fireEvent.click(screen.getByRole("button", { name: `${en.actions.strokeSize} ([ / ])` }));
    expect(handlers.ontogglecolors).toHaveBeenCalledTimes(1);
    expect(handlers.ontogglesizes).toHaveBeenCalledTimes(1);
  });

  it("wires undo/redo to callbacks and respects disabled state", async () => {
    const { handlers } = renderToolbar({ canUndo: true, canRedo: false });
    const undoBtn = screen.getByRole("button", { name: `${en.actions.undo} (Cmd+Z)` }) as HTMLButtonElement;
    const redoBtn = screen.getByRole("button", { name: `${en.actions.redo} (Cmd+Shift+Z)` }) as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);
    await fireEvent.click(undoBtn);
    expect(handlers.onundo).toHaveBeenCalledTimes(1);
    expect(handlers.onredo).not.toHaveBeenCalled();
  });

  it("collapses to the minimal pill bar and expands via callback", async () => {
    const collapsedView = renderToolbar({ collapsed: true });
    expect(collapsedView.container.querySelector(".floating-toolbar.collapsed")).toBeTruthy();
    expect(collapsedView.container.textContent).toContain(en.tools.select);
    await fireEvent.click(screen.getByRole("button", { name: en.actions.expandToolbar }));
    expect(collapsedView.handlers.ontogglecollapsed).toHaveBeenCalledWith(false);
    collapsedView.unmount();

    const expanded = renderToolbar({ collapsed: false });
    await fireEvent.click(screen.getByRole("button", { name: en.actions.collapseToolbar }));
    expect(expanded.handlers.ontogglecollapsed).toHaveBeenCalledWith(true);
  });

  it("hides the size trigger when sizeControl is false", () => {
    renderToolbar({ sizeControl: false, showSizes: true });
    expect(screen.queryByRole("button", { name: `${en.actions.strokeSize} ([ / ])` })).toBeNull();
    expect(screen.queryByRole("button", { name: "8px" })).toBeNull();
  });

  it("switches tooltips when the language changes", async () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: `${en.tools.select} (V)` })).toBeTruthy();
    setLang("vi");
    await tick();
    expect(screen.getByRole("button", { name: `${viDict.tools.select} (V)` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `${en.tools.select} (V)` })).toBeNull();
  });
});
