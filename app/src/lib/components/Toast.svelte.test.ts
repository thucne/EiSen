import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Toast from "./Toast.svelte";

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("renders the message with ok styling", () => {
    const { container } = render(Toast, {
      props: { message: "Saved to disk", kind: "ok" },
    });
    const el = container.querySelector(".toast");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("toast-ok")).toBe(true);
    expect(el?.classList.contains("toast-err")).toBe(false);
    expect(el?.textContent).toBe("Saved to disk");
  });

  it("renders err styling for kind=err", () => {
    const { container } = render(Toast, {
      props: { message: "boom", kind: "err" },
    });
    const el = container.querySelector(".toast");
    expect(el?.classList.contains("toast-err")).toBe(true);
    expect(el?.classList.contains("toast-ok")).toBe(false);
  });

  it("fires onexpire after the default 2200ms", async () => {
    vi.useFakeTimers();
    const onexpire = vi.fn();
    render(Toast, { props: { message: "hi", kind: "ok", onexpire } });
    await tick();
    await vi.advanceTimersByTimeAsync(2199);
    expect(onexpire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onexpire).toHaveBeenCalledTimes(1);
  });

  it("honors a custom duration", async () => {
    vi.useFakeTimers();
    const onexpire = vi.fn();
    render(Toast, { props: { message: "hi", kind: "ok", duration: 500, onexpire } });
    await tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(onexpire).toHaveBeenCalledTimes(1);
  });

  it("never expires while sticky (duration null)", async () => {
    vi.useFakeTimers();
    const onexpire = vi.fn();
    render(Toast, {
      props: { message: "persistent error", kind: "err", duration: null, onexpire },
    });
    await tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onexpire).not.toHaveBeenCalled();
  });
});
