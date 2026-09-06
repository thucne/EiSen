import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TextMarker from "./TextMarker.svelte";
import type { TextElement } from "./elements";

const el: TextElement = {
  id: 7,
  kind: "text",
  x: 10,
  y: 20,
  text: "hello",
  color: "#ef4444",
  size: 18,
};

describe("TextMarker", () => {
  it("uses one node: outline only while editing", async () => {
    const { container, rerender } = render(TextMarker, {
      props: {
        element: el,
        editing: true,
        oninputtext: vi.fn(),
        oncommit: vi.fn(),
      },
    });
    const node = container.querySelector("[data-el-id='7']") as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(node.classList.contains("editing")).toBe(true);

    await rerender({
      element: el,
      editing: false,
      oninputtext: vi.fn(),
      oncommit: vi.fn(),
    });
    const same = container.querySelector("[data-el-id='7']") as HTMLElement;
    expect(same).toBe(node);
    expect(same.getAttribute("contenteditable")).toBe("false");
    expect(same.classList.contains("editing")).toBe(false);
  });

  it("stopPropagation on pointerdown so canvas drag does not hijack text selection", () => {
    const { container } = render(TextMarker, {
      props: {
        element: el,
        editing: true,
        oninputtext: vi.fn(),
        oncommit: vi.fn(),
      },
    });
    const node = container.querySelector("[data-el-id='7']") as HTMLElement;
    const event = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    expect(event.cancelBubble).toBe(true);
    expect(node.classList.contains("editing")).toBe(true);
  });

  it("stays transparent while editing so the capture shows through", async () => {
    const { container, rerender } = render(TextMarker, {
      props: { element: el, editing: true, oninputtext: vi.fn(), oncommit: vi.fn() },
    });
    const node = container.querySelector(".text-marker") as HTMLElement;
    expect(node.classList.contains("editing")).toBe(true);

    // happy-dom does not inject Svelte <style> at runtime (styleSheets is empty);
    // assert via source file (also check any injected styles as fallback).
    let cssText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    try {
      const sheets = Array.from(document.styleSheets)
        .flatMap((sh) => {
          try {
            return Array.from(sh.cssRules).map((r) => (r as CSSStyleRule).cssText ?? "");
          } catch {
            return [];
          }
        })
        .join("\n");
      cssText += `\n${sheets}`;
    } catch {
      // ignore
    }
    if (!cssText.includes("background: transparent")) {
      const p = path.resolve(process.cwd(), "src/lib/editor/TextMarker.svelte");
      try {
        cssText += `\n${fs.readFileSync(p, "utf8")}`;
      } catch {
        // ignore
      }
    }
    expect(cssText).toContain("background: transparent");
    expect(cssText).not.toContain("rgba(18, 20, 29, 0.88)");
    expect(cssText).not.toContain("backdrop-filter");
    expect(cssText).not.toContain("outline: 1.5px dashed");
    expect(cssText).toContain("padding: 6px 10px");

    await rerender({ element: el, editing: false, oninputtext: vi.fn(), oncommit: vi.fn() });
    expect(container.querySelector(".text-marker")!.classList.contains("editing")).toBe(false);
  });

  it("editing chrome does not round or clip the marker", async () => {
    const { container } = render(TextMarker, {
      props: { element: el, editing: true, oninputtext: vi.fn(), oncommit: vi.fn() },
    });
    let cssText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    try {
      const sheets = Array.from(document.styleSheets)
        .flatMap((sh) => {
          try {
            return Array.from(sh.cssRules).map((r) => (r as CSSStyleRule).cssText ?? "");
          } catch {
            return [];
          }
        })
        .join("\n");
      cssText += `\n${sheets}`;
    } catch {
      // ignore
    }
    if (!cssText.includes("text-marker")) {
      const p = path.resolve(process.cwd(), "src/lib/editor/TextMarker.svelte");
      try {
        cssText += `\n${fs.readFileSync(p, "utf8")}`;
      } catch {
        // ignore
      }
    }
    expect(cssText).not.toMatch(/border-radius:\s*8px/);
    expect(cssText).toContain("background: transparent");
  });
});
