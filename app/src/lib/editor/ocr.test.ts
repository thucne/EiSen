import { describe, expect, it, vi } from "vitest";
import { extractEditorTextWithSnapshot } from "./ocr";

describe("editor OCR source", () => {
  it("uses native OCR on the pinned image when there are no rendered changes", async () => {
    const extractPinned = vi.fn().mockResolvedValue("pinned image text");
    const renderSnapshot = vi.fn();
    const extractRendered = vi.fn();

    await expect(
      extractEditorTextWithSnapshot({
        hasRenderedChanges: false,
        extractPinned,
        renderSnapshot,
        extractRendered,
      }),
    ).resolves.toBe("pinned image text");
    expect(extractPinned).toHaveBeenCalledOnce();
    expect(renderSnapshot).not.toHaveBeenCalled();
    expect(extractRendered).not.toHaveBeenCalled();
  });

  it("passes the same rendered bytes to native OCR for annotations or a pending crop", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const renderSnapshot = vi.fn().mockResolvedValue(bytes);
    const extractRendered = vi.fn().mockResolvedValue("visible text");
    const extractPinned = vi.fn();

    await expect(
      extractEditorTextWithSnapshot({
        hasRenderedChanges: true,
        extractPinned,
        renderSnapshot,
        extractRendered,
      }),
    ).resolves.toBe("visible text");
    expect(renderSnapshot).toHaveBeenCalledOnce();
    expect(extractRendered).toHaveBeenCalledWith(bytes);
    expect(extractPinned).not.toHaveBeenCalled();
  });
});
