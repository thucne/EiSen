import { render, waitFor } from "@testing-library/svelte";
import type { Snippet } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  goto: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, callback: (event: { payload: unknown }) => void) => {
    h.listeners.set(event, callback);
    return Promise.resolve(() => h.listeners.delete(event));
  },
}));
vi.mock("$app/navigation", () => ({ goto: h.goto }));
vi.mock("$lib/i18n", () => ({ watchLang: vi.fn().mockResolvedValue(() => {}) }));

import Layout from "./+layout.svelte";

const emptyChildren = (() => undefined) as unknown as Snippet;

beforeEach(() => {
  h.listeners.clear();
  h.goto.mockReset().mockResolvedValue(undefined);
});

describe("route history handoff", () => {
  it("returns to the hub when the tray requests History", async () => {
    render(Layout, { props: { children: emptyChildren } });
    await waitFor(() => expect(h.listeners.has("show-history")).toBe(true));

    h.listeners.get("show-history")?.({ payload: undefined });
    expect(h.goto).toHaveBeenCalledWith("/");
  });
});
