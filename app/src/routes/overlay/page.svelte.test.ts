import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: h.invoke,
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.set(event, cb);
    return Promise.resolve(() => h.listeners.delete(event));
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: vi.fn().mockResolvedValue(undefined) }),
}));

import OverlayPage from "./+page.svelte";
import { en } from "$lib/i18n/en";

function emit(event: string): void {
  const cb = h.listeners.get(event);
  if (!cb) throw new Error(`no listener registered for ${event}`);
  cb({ payload: null });
}

function toolbarBtn(name: string) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.listeners.clear();
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

function fullscreenSession() {
  return {
    path: "/tmp/eisen-region.png",
    rect: { left: 0, top: 0, width: 100, height: 80 },
    scale: 1,
  };
}

describe("overlay IPC contract", () => {
  it("posts exactly { rect, openEditor } to cmd_commit_region (Tauri camelCase arg contract)", async () => {
    h.invoke.mockResolvedValue(fullscreenSession());
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready"); // pre-selects the viewport; avoids pointer-drag simulation
    await tick();
    fireEvent.click(toolbarBtn(en.overlay.openEditor));
    await waitFor(() => {
      expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_commit_region")).toBe(true);
    });
    const [, args] = h.invoke.mock.calls.find(([cmd]) => cmd === "cmd_commit_region")!;
    expect(Object.keys(args).sort()).toEqual(["openEditor", "rect"]);
    expect(args.openEditor).toBe(true);
    expect(args.rect.width).toBeGreaterThan(0);
  });

  it("calls cmd_extract_text with no arguments and copies the result", async () => {
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "cmd_commit_region"
        ? Promise.resolve(fullscreenSession())
        : cmd === "cmd_extract_text"
          ? Promise.resolve("hello world")
          : Promise.resolve(undefined),
    );
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    fireEvent.click(toolbarBtn(`${en.actions.extractText} (O)`));
    await waitFor(() => {
      expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_extract_text")).toBe(true);
    });
    expect(h.invoke).toHaveBeenCalledWith("cmd_extract_text");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world");
  });

  it("uses instant data-tip labels instead of delayed native title", async () => {
    h.invoke.mockResolvedValue(fullscreenSession());
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    const ocr = toolbarBtn(`${en.actions.extractText} (O)`);
    expect(ocr.getAttribute("data-tip")).toBe(`${en.actions.extractText} (O)`);
    expect(ocr.getAttribute("title")).toBeNull();
  });

  it("orders cancel apart from actions, with copy last as the default", async () => {
    h.invoke.mockResolvedValue(fullscreenSession());
    const { container } = render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    const labels = [...container.querySelectorAll(".floating-toolbar button")].map((btn) =>
      btn.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      `${en.actions.cancel} (Esc)`,
      `${en.actions.extractText} (O)`,
      `${en.actions.saveFile} (S)`,
      en.overlay.openEditor,
      `${en.overlay.copyToClipboard} (Enter / DblClick)`,
    ]);
    const copy = toolbarBtn(`${en.overlay.copyToClipboard} (Enter / DblClick)`);
    expect(copy.classList.contains("primary")).toBe(true);
  });

  it("copies on Enter even when another toolbar button is focused", async () => {
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "cmd_commit_region"
        ? Promise.resolve(fullscreenSession())
        : Promise.resolve(undefined),
    );
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    toolbarBtn(`${en.actions.extractText} (O)`).focus();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => {
      expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_copy")).toBe(true);
    });
    expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_extract_text")).toBe(false);
    expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_cancel_capture")).toBe(false);
  });
});

describe("overlay feedback", () => {
  it("shows a success toast after copy", async () => {
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "cmd_commit_region"
        ? Promise.resolve(fullscreenSession())
        : Promise.resolve(undefined),
    );
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    fireEvent.click(toolbarBtn(`${en.overlay.copyToClipboard} (Enter / DblClick)`));
    expect(await screen.findByText(en.toasts.copied)).toBeTruthy();
  });

  it("shows an error toast containing the command failure", async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_commit_region") return Promise.resolve(fullscreenSession());
      if (cmd === "cmd_copy") return Promise.reject(new Error("clipboard busy"));
      return Promise.resolve(undefined);
    });
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    fireEvent.click(toolbarBtn(`${en.overlay.copyToClipboard} (Enter / DblClick)`));
    const toast = await screen.findByText(new RegExp(en.overlay.actionFailed));
    expect(toast.textContent).toMatch(/clipboard busy/);
  });

  it("shows the no-text message when OCR returns empty", async () => {
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "cmd_commit_region"
        ? Promise.resolve(fullscreenSession())
        : cmd === "cmd_extract_text"
          ? Promise.resolve("")
          : Promise.resolve(undefined),
    );
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    fireEvent.click(toolbarBtn(`${en.actions.extractText} (O)`));
    expect(await screen.findByText(en.ocr.noText)).toBeTruthy();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("shows the OCR success message and still writes the clipboard", async () => {
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "cmd_commit_region"
        ? Promise.resolve(fullscreenSession())
        : cmd === "cmd_extract_text"
          ? Promise.resolve("hello world")
          : Promise.resolve(undefined),
    );
    render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("fullscreen-ready")).toBe(true));
    emit("fullscreen-ready");
    await tick();
    fireEvent.click(toolbarBtn(`${en.actions.extractText} (O)`));
    expect(await screen.findByText(en.ocr.copied)).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world");
  });
});

describe("overlay selection editing", () => {
  async function mountOverlay() {
    const view = render(OverlayPage);
    await waitFor(() => expect(h.listeners.has("capture-ready")).toBe(true));
    emit("capture-ready");
    await tick();
    return view;
  }

  it("does not cancel the capture on a stray click", async () => {
    const { container } = await mountOverlay();
    const viewport = container.querySelector(".overlay-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 50, clientY: 50 });
    await tick();
    expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_cancel_capture")).toBe(false);
    expect(screen.getByText(en.overlay.hint)).toBeTruthy();
  });

  it("still cancels on Escape", async () => {
    await mountOverlay();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(h.invoke.mock.calls.some(([cmd]) => cmd === "cmd_cancel_capture")).toBe(true);
    });
  });

  it("confirms a real drag and reports its size", async () => {
    const { container } = await mountOverlay();
    const viewport = container.querySelector(".overlay-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 250 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 300, clientY: 250 });
    await tick();
    expect(screen.getByText("200 × 150 px")).toBeTruthy();
  });

  it("nudges a confirmed selection with arrow keys", async () => {
    const { container } = await mountOverlay();
    const viewport = container.querySelector(".overlay-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 250 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 300, clientY: 250 });
    await tick();
    const frame = () => container.querySelector(".crop-frame") as HTMLElement;
    expect(frame().style.left).toBe("100px");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await tick();
    expect(frame().style.left).toBe("101px");
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    await tick();
    expect(frame().style.left).toBe("111px");
  });

  it("does not square a confirmed selection when Shift is held to nudge", async () => {
    const { container } = await mountOverlay();
    const viewport = container.querySelector(".overlay-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 250 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 300, clientY: 250 });
    await tick();
    expect(screen.getByText("200 × 150 px")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Shift" });
    await tick();
    expect(screen.getByText("200 × 150 px")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    await tick();
    const frame = container.querySelector(".crop-frame") as HTMLElement;
    expect(frame.style.left).toBe("110px");
    expect(screen.getByText("200 × 150 px")).toBeTruthy();
  });

  it("still squares while drawing with Shift held", async () => {
    const { container } = await mountOverlay();
    const viewport = container.querySelector(".overlay-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 150, shiftKey: true });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 200, clientY: 150, shiftKey: true });
    await tick();
    expect(screen.getByText("100 × 100 px")).toBeTruthy();
  });

  it("cannot nudge the selection out of the viewport", async () => {
    const { container } = await mountOverlay();
    const viewport = container.querySelector(".overlay-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 0, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 250 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 200, clientY: 250 });
    await tick();
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    }
    await tick();
    const left = parseFloat((container.querySelector(".crop-frame") as HTMLElement).style.left);
    expect(left).toBeGreaterThanOrEqual(0);
  });
});
