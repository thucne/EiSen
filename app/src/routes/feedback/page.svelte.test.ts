import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.set(event, cb);
    return Promise.resolve(() => h.listeners.delete(event));
  },
}));

import FeedbackPage from "./+page.svelte";
import { en } from "$lib/i18n/en";

function show(payload: { message: string; kind: string; path: string | null }) {
  h.listeners.get("feedback-show")!({ payload });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockResolvedValue(undefined);
  h.listeners.clear();
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
