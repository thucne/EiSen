import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));

let nextFeedbackId = 0;

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
  h.listeners.get("feedback-show")!({ payload: { id: ++nextFeedbackId, ...payload } });
}

function invoked(command: string) {
  return h.invoke.mock.calls.some(([name]) => name === command);
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
  nextFeedbackId = 0;
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
    await waitFor(() => expect(invoked("cmd_hide_feedback")).toBe(true));
    expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback", {
      feedbackId: 1,
      preview: "/tmp/eisen/preview/a.png",
    });
  });

  it("stays open when the editor cannot open", async () => {
    const preview = await showThumbnail();
    h.invoke.mockRejectedValueOnce("a capture is in progress");
    await fireEvent.click(preview);
    expect(await screen.findByText("a capture is in progress")).toBeTruthy();
    expect(invoked("cmd_hide_feedback")).toBe(false);
  });

  it("ignores an editor result after a newer notification replaces it", async () => {
    let finishOpen!: () => void;
    h.invoke.mockImplementation((command: string) => {
      if (command === "cmd_open_in_editor") {
        return new Promise<void>((resolve) => {
          finishOpen = resolve;
        });
      }
      return Promise.resolve();
    });

    const preview = await showThumbnail();
    await fireEvent.click(preview);
    show({ message: "New capture", kind: "ok", path: null, preview: "/tmp/new.png" });
    finishOpen();

    expect(await screen.findByText("New capture")).toBeTruthy();
    expect(invoked("cmd_hide_feedback")).toBe(false);
  });

  it("dismisses from the close control", async () => {
    await showThumbnail();
    await fireEvent.click(screen.getByRole("button", { name: en.feedback.dismiss }));
    await waitFor(() => expect(invoked("cmd_hide_feedback")).toBe(true));
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
    expect(invoked("cmd_start_preview_drag")).toBe(false);
    await fireEvent.pointerMove(preview, { clientX: 0, clientY: 10 });
    expect(h.invoke).toHaveBeenCalledWith("cmd_start_preview_drag", {
      feedbackId: 1,
      preview: "/tmp/eisen/preview/a.png",
    });
    expect(h.invoke.mock.calls.filter(([cmd]) => cmd === "cmd_start_preview_drag")).toHaveLength(1);
  });

  it("initiates file drag on diagonal or upward-right drags instead of swiping to dismiss", async () => {
    const preview = await showThumbnail();
    await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 50 });
    await fireEvent.pointerMove(preview, { clientX: 22, clientY: 38 });
    expect(h.invoke).toHaveBeenCalledWith("cmd_start_preview_drag", {
      feedbackId: 1,
      preview: "/tmp/eisen/preview/a.png",
    });
    expect(invoked("cmd_hide_feedback")).toBe(false);
  });

  it("switches from a slight rightward start into file drag when pulled vertically", async () => {
    const preview = await showThumbnail();
    await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 50 });
    await fireEvent.pointerMove(preview, { clientX: 24, clientY: 50 });
    expect(invoked("cmd_start_preview_drag")).toBe(false);
    expect(preview.parentElement?.getAttribute("style")).toContain("translateX(14px)");

    await fireEvent.pointerMove(preview, { clientX: 28, clientY: 12 });
    expect(h.invoke).toHaveBeenCalledWith("cmd_start_preview_drag", {
      feedbackId: 1,
      preview: "/tmp/eisen/preview/a.png",
    });
    expect(preview.parentElement?.getAttribute("style") ?? "").not.toContain("translateX");
  });

  it("allows clicking to open the editor after a cancelled native file drag", async () => {
    const preview = await showThumbnail();
    await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(preview, { clientX: 0, clientY: 10 });
    h.listeners.get("feedback-drag-ended")!({ payload: 1 });
    await tick();

    await fireEvent.click(preview);
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("cmd_open_in_editor", { path: "/tmp/eisen/preview/a.png" }),
    );
  });

  it("does not dismiss while hovered or dragged, and resumes after the drag", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerEnter(preview.parentElement!);
      vi.advanceTimersByTime(60_000);
      expect(invoked("cmd_hide_feedback")).toBe(false);

      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 0, clientY: 10 });
      await fireEvent.pointerLeave(preview.parentElement!);
      vi.advanceTimersByTime(60_000);
      expect(invoked("cmd_hide_feedback")).toBe(false);

      h.listeners.get("feedback-drag-ended")!({ payload: 1 });
      vi.advanceTimersByTime(60_000);
      expect(invoked("cmd_hide_feedback")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an old drag-end event while a newer preview is being dragged", async () => {
    const firstPreview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(firstPreview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(firstPreview, { clientX: 0, clientY: 10 });

      show({ message: "New capture", kind: "ok", path: null, preview: "/tmp/new.png" });
      await tick();
      const newPreview = screen.getByRole("button", { name: en.feedback.openInEditor });
      await fireEvent.pointerDown(newPreview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(newPreview, { clientX: 0, clientY: 10 });

      h.listeners.get("feedback-drag-ended")!({ payload: 1 });
      vi.advanceTimersByTime(2000);
      expect(invoked("cmd_hide_feedback")).toBe(false);

      h.listeners.get("feedback-drag-ended")!({ payload: 2 });
      vi.advanceTimersByTime(1600);
      expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback", {
        feedbackId: 2,
        preview: "/tmp/new.png",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies lifted dragging state on the card and dismisses after a successful drop", async () => {
    const preview = await showThumbnail();
    const card = preview.parentElement!;

    await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 50 });
    await fireEvent.pointerMove(preview, { clientX: 20, clientY: 20 });
    await tick();
    expect(card.classList.contains("dragging")).toBe(true);

    h.listeners.get("feedback-drag-dropped")!({ payload: 1 });
    await tick();
    expect(h.invoke).toHaveBeenCalledWith("cmd_hide_feedback", {
      feedbackId: 1,
      preview: "/tmp/eisen/preview/a.png",
    });
  });

  it("follows pointer swipe right live and waits for release before dismissing", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 130, clientY: 10 });
      expect(invoked("cmd_start_preview_drag")).toBe(false);
      expect(preview.parentElement?.getAttribute("style")).toContain("translateX(120px)");
      // Still holding pointer down: must NOT auto-dismiss before release
      vi.advanceTimersByTime(500);
      expect(invoked("cmd_hide_feedback")).toBe(false);

      await fireEvent.pointerUp(preview, { clientX: 130, clientY: 10 });
      vi.advanceTimersByTime(250);
      expect(invoked("cmd_hide_feedback")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("snaps back on release under dismiss threshold or when pulled back left", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 130, clientY: 10 });
      expect(preview.parentElement?.getAttribute("style")).toContain("translateX(120px)");

      // Pull back inside threshold before releasing
      await fireEvent.pointerMove(preview, { clientX: 50, clientY: 10 });
      expect(preview.parentElement?.getAttribute("style")).toContain("translateX(40px)");

      await fireEvent.pointerUp(preview, { clientX: 50, clientY: 10 });
      await fireEvent.click(preview);
      vi.advanceTimersByTime(300);
      expect(preview.parentElement?.getAttribute("style") ?? "").not.toContain("translateX");
      expect(invoked("cmd_hide_feedback")).toBe(false);
      expect(h.invoke).not.toHaveBeenCalledWith("cmd_open_in_editor", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses on a brisk rightward flick when released past minimum flick distance", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(20);
      await fireEvent.pointerMove(preview, { clientX: 45, clientY: 10 });
      vi.advanceTimersByTime(20);
      await fireEvent.pointerMove(preview, { clientX: 80, clientY: 10 });
      vi.advanceTimersByTime(5);
      await fireEvent.pointerUp(preview, { clientX: 80, clientY: 10 });
      vi.advanceTimersByTime(250);
      expect(invoked("cmd_hide_feedback")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not dismiss on a slow or paused short swipe under threshold", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(20);
      await fireEvent.pointerMove(preview, { clientX: 80, clientY: 10 });
      // Pause > 90ms before releasing: velocity decays so short distance snaps back
      vi.advanceTimersByTime(150);
      await fireEvent.pointerUp(preview, { clientX: 80, clientY: 10 });
      await tick();
      vi.advanceTimersByTime(250);
      expect(preview.parentElement?.getAttribute("style") ?? "").not.toContain("translateX");
      expect(invoked("cmd_hide_feedback")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    "follows trackpad horizontal swipe and snaps back when under threshold (natural=%s)",
    async (natural) => {
      const preview = await showThumbnail();
      vi.useFakeTimers();
      try {
        const sign = natural ? -1 : 1;
        // Swiping left from rest does nothing
        const leftWheel = new WheelEvent("wheel", { deltaX: sign * -120, deltaY: 0 });
        Object.defineProperty(leftWheel, "webkitDirectionInvertedFromDevice", { value: natural });
        await fireEvent(preview.parentElement!, leftWheel);
        vi.advanceTimersByTime(200);
        await tick();
        expect(invoked("cmd_hide_feedback")).toBe(false);

        // Small swipe right follows live, then snaps back cleanly without dismissing
        const smallWheel = new WheelEvent("wheel", { deltaX: sign * 35, deltaY: 0 });
        Object.defineProperty(smallWheel, "webkitDirectionInvertedFromDevice", { value: natural });
        await fireEvent(preview.parentElement!, smallWheel);
        expect(preview.parentElement?.getAttribute("style")).toContain("translateX(35px)");
        vi.advanceTimersByTime(150);
        await tick();
        expect(preview.parentElement?.getAttribute("style") ?? "").not.toContain("translateX");
        expect(invoked("cmd_hide_feedback")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([false, true])(
    "accumulates smooth horizontal wheel movement to dismiss (natural=%s)",
    async (natural) => {
      const preview = await showThumbnail();
      vi.useFakeTimers();
      try {
        const sign = natural ? -1 : 1;
        for (let i = 0; i < 6; i += 1) {
          const ev = new WheelEvent("wheel", { deltaX: sign * 20, deltaY: 0 });
          Object.defineProperty(ev, "webkitDirectionInvertedFromDevice", { value: natural });
          await fireEvent(preview.parentElement!, ev);
        }
        expect(preview.parentElement?.getAttribute("style")).toContain("translateX(120px)");
        vi.advanceTimersByTime(350);
        expect(invoked("cmd_hide_feedback")).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("ignores vertical wheel movement and resets small deltas after a pause", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 8; i += 1) {
        await fireEvent.wheel(preview.parentElement!, { deltaX: 5, deltaY: 6 });
      }
      const zoomEvent = new WheelEvent("wheel", { deltaX: 40, deltaY: 0 });
      Object.defineProperty(zoomEvent, "ctrlKey", { value: true });
      await fireEvent(preview.parentElement!, zoomEvent);
      for (let i = 0; i < 4; i += 1) {
        await fireEvent.wheel(preview.parentElement!, { deltaX: 25, deltaY: 0 });
        vi.advanceTimersByTime(150);
      }
      expect(invoked("cmd_hide_feedback")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an old slide-out when new feedback arrives", async () => {
    const preview = await showThumbnail();
    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(preview, { button: 0, clientX: 10, clientY: 10 });
      await fireEvent.pointerMove(preview, { clientX: 130, clientY: 10 });
      await fireEvent.pointerUp(preview, { clientX: 130, clientY: 10 });
      show({ message: "New capture", kind: "ok", path: null, preview: "/tmp/new.png" });
      await tick();

      vi.advanceTimersByTime(250);
      expect(screen.getByText("New capture")).toBeTruthy();
      expect(invoked("cmd_hide_feedback")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-dismisses thumbnail after 1.5s by default", async () => {
    vi.useFakeTimers();
    try {
      await showThumbnail();
      vi.advanceTimersByTime(1400);
      expect(invoked("cmd_hide_feedback")).toBe(false);
      vi.advanceTimersByTime(200);
      expect(invoked("cmd_hide_feedback")).toBe(true);
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
      expect(invoked("cmd_hide_feedback")).toBe(false);
      vi.advanceTimersByTime(1100);
      expect(invoked("cmd_hide_feedback")).toBe(true);
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
    await waitFor(() => expect(invoked("cmd_hide_feedback")).toBe(true));
  });
});
