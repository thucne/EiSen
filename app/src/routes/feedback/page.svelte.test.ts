import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
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

import FeedbackPage from "./+page.svelte";
import { en } from "$lib/i18n/en";

function show(payload: { message: string; kind: string; path: string | null; preview?: string | null }) {
  h.listeners.get("feedback-show")!({ payload });
}

async function showThumbnail(path: string | null = null) {
  render(FeedbackPage);
  await waitFor(() => expect(h.listeners.has("feedback-show")).toBe(true));
  show({ message: en.toasts.copied, kind: "ok", path, preview: "/tmp/eisen/preview/a.png" });
  return screen.findByRole("button", { name: en.feedback.openInEditor });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockResolvedValue(undefined);
  h.listeners.clear();
});

describe("floating thumbnail", () => {
  it("shows the kept image", async () => {
    const preview = await showThumbnail();
    expect(preview.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("/tmp/eisen/preview/a.png"),
    );
    expect(screen.getByText(en.toasts.copied)).toBeTruthy();
  });

  it("opens the editor on click, then hides", async () => {
    await fireEvent.click(await showThumbnail());
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("cmd_open_in_editor", { path: "/tmp/eisen/preview/a.png" }),
    );
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback"));
  });

  it("stays open when the editor cannot open", async () => {
    const preview = await showThumbnail();
    h.invoke.mockRejectedValueOnce("a capture is in progress");
    await fireEvent.click(preview);
    expect(await screen.findByText("a capture is in progress")).toBeTruthy();
    expect(h.invoke).not.toHaveBeenCalledWith("cmd_hide_feedback");
  });

  it("dismisses from the close control", async () => {
    await showThumbnail();
    await fireEvent.click(screen.getByRole("button", { name: en.feedback.dismiss }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback"));
    expect(h.invoke).not.toHaveBeenCalledWith("cmd_open_in_editor", expect.anything());
  });

  it("still offers Show in folder for a saved capture", async () => {
    await showThumbnail("/tmp/a.png");
    await fireEvent.click(screen.getByRole("button", { name: en.feedback.reveal }));
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("cmd_reveal_path", { path: "/tmp/a.png" }),
    );
  });

  it("starts a drag past the threshold, not on a small wobble", async () => {
    const preview = await showThumbnail();
    await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(preview, { clientX: 8, clientY: 10 });
    expect(h.invoke).not.toHaveBeenCalledWith("cmd_start_preview_drag");
    await fireEvent.pointerMove(preview, { clientX: 0, clientY: 10 });
    expect(h.invoke).toHaveBeenCalledWith("cmd_start_preview_drag");
    expect(h.invoke.mock.calls.filter(([cmd]) => cmd === "cmd_start_preview_drag")).toHaveLength(1);
  });

  it("does not dismiss while hovered or dragged, and resumes after the drag", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerEnter(preview.parentElement!);
      vi.advanceTimersByTime(60_000);
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_hide_feedback");

      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 0, clientY: 0 });
      await fireEvent.pointerLeave(preview.parentElement!);
      vi.advanceTimersByTime(60_000);
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_hide_feedback");

      h.listeners.get("feedback-drag-ended")!({ payload: null });
      vi.advanceTimersByTime(60_000);
      expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("swipes right to dismiss past 50px threshold", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 70, clientY: 10 });
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_start_preview_drag");
      // Slide animation runs, then dismisses
      vi.advanceTimersByTime(250);
      expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("snaps back on swipe under threshold without dismissing", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 30, clientY: 10 });
      await fireEvent.pointerUp(preview);
      vi.advanceTimersByTime(100);
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_hide_feedback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses on trackpad horizontal swipe right", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.wheel(preview.parentElement!, { deltaX: 30 });
      vi.advanceTimersByTime(250);
      expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-dismisses thumbnail after 1.5s by default", async () => {
    vi.useFakeTimers();
    try {
      await showThumbnail();
      vi.advanceTimersByTime(1400);
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_hide_feedback");
      vi.advanceTimersByTime(200);
      expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects custom duration_ms in feedback payload", async () => {
    vi.useFakeTimers();
    try {
      render(FeedbackPage);
      await waitFor(() => expect(h.listeners.has("feedback-show")).toBe(true));
      show({ message: en.toasts.copied, kind: "ok", path: null, preview: "/tmp/a.png", duration_ms: 3000 } as any);
      vi.advanceTimersByTime(2000);
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_hide_feedback");
      vi.advanceTimersByTime(1100);
      expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("feedback window", () => {
  it("offers no folder action without a saved path", async () => {
    render(FeedbackPage);
    await waitFor(() => expect(h.listeners.has("feedback-show")).toBe(true));
    show({ message: en.toasts.copied, kind: "ok", path: null });
    expect(await screen.findByText(en.toasts.copied)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.feedback.reveal })).toBeNull();
  });

  it("reveals the saved file, then hides", async () => {
    render(FeedbackPage);
    await waitFor(() => expect(h.listeners.has("feedback-show")).toBe(true));
    show({ message: "Saved: a.png", kind: "ok", path: "/tmp/a.png" });
    await fireEvent.click(await screen.findByRole("button", { name: en.feedback.reveal }));
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("cmd_reveal_path", { path: "/tmp/a.png" }),
    );
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback"));
  });
});
