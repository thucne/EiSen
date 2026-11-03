import { describe, expect, it } from "vitest";
import { CLOSE_CONFIRM_WINDOW_MS, createCloseGuard } from "./closeGuard";

describe("createCloseGuard", () => {
  it("closes at once when nothing is unsaved", () => {
    expect(createCloseGuard(() => 0).allowClose(false)).toBe(true);
  });

  it("warns first, then closes on a second request inside the window", () => {
    let t = 0;
    const guard = createCloseGuard(() => t);
    expect(guard.allowClose(true)).toBe(false);
    t = CLOSE_CONFIRM_WINDOW_MS;
    expect(guard.allowClose(true)).toBe(true);
  });

  it("warns again once the window has passed", () => {
    let t = 0;
    const guard = createCloseGuard(() => t);
    expect(guard.allowClose(true)).toBe(false);
    t = CLOSE_CONFIRM_WINDOW_MS + 1;
    expect(guard.allowClose(true)).toBe(false);
  });
});
